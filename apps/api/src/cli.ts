import { userInfo } from 'node:os'
import { createDb } from '@hcn/db'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { bootstrapSchool, grantReviewer, revokeReviewer, seedCurriculum, systemClock } from '@hcn/domain'
import { KeycloakAdmin } from './adapters/keycloak-admin.ts'
import { loadConfig } from './config.ts'
import { seedStaging, stagingObservations, stagingSubmissions } from './seed-staging.ts'

const [command, ...rest] = process.argv.slice(2)

function flag(name: string): string | undefined {
  const index = rest.indexOf(`--${name}`)
  const value = index >= 0 ? rest[index + 1] : undefined
  return value && !value.startsWith('--') ? value : undefined
}

const config = loadConfig()
const db = createDb(config.databaseUrl)

try {
  if (command === 'bootstrap-school') {
    const name = flag('name')
    const code = flag('code')
    const adminUsername = flag('admin-username')
    if (!name || !code || !adminUsername || !config.keycloakProvisionerSecret) {
      console.error('Cấu hình không hợp lệ: --name, --code, --admin-username, KEYCLOAK_PROVISIONER_SECRET')
      process.exit(1)
    }
    const idp = new KeycloakAdmin({
      issuer: config.oidcIssuer,
      clientId: config.keycloakProvisionerClientId ?? 'hcn-provisioner',
      clientSecret: config.keycloakProvisionerSecret,
    })
    const result = await bootstrapSchool(db, idp, {
      name,
      code,
      adminUsername,
      issuer: config.oidcIssuer,
      requestId: 'cli-bootstrap',
    })
    console.log(`school=${result.schoolId} user=${result.userId} created=${result.created}`)
  } else if (command === 'seed-curriculum') {
    const file = rest[0]
    if (!file) {
      console.error('Cấu hình không hợp lệ: seed-curriculum <json|csv>')
      process.exit(1)
    }
    const result = await seedCurriculum(db, file)
    console.log(`added=${result.added} updated=${result.updated} skipped=${result.skipped}`)
  } else if (command === 'grant-reviewer' || command === 'revoke-reviewer') {
    const username = flag('username')
    const subject = flag('subject')
    const grantedByName = flag('granted-by')
    if (!username || !subject || !grantedByName || !config.keycloakProvisionerSecret) {
      console.error('Cấu hình không hợp lệ: --username, --subject, --granted-by, KEYCLOAK_PROVISIONER_SECRET')
      process.exit(1)
    }
    const idp = new KeycloakAdmin({
      issuer: config.oidcIssuer,
      clientId: config.keycloakProvisionerClientId ?? 'hcn-provisioner',
      clientSecret: config.keycloakProvisionerSecret,
    })
    const userId = await userIdByUsername(idp, username)
    const grantedBy = await userIdByUsername(idp, grantedByName)
    const meta = {
      actor: { userId: grantedBy, schoolId: '00000000-0000-4000-8000-000000000000', roles: ['admin' as const] },
      requestId: 'cli-reviewer',
      clock: systemClock,
    }
    const osUser = userInfo().username
    const result = command === 'grant-reviewer'
      ? await grantReviewer(db, meta, { userId, subjectCode: subject, grantedBy, osUser })
      : await revokeReviewer(db, meta, { userId, subjectCode: subject, osUser })
    console.log(JSON.stringify(result))
  } else if (command === 'seed-staging') {
    if (!config.keycloakProvisionerSecret) {
      console.error('Cấu hình không hợp lệ: KEYCLOAK_PROVISIONER_SECRET')
      process.exit(1)
    }
    const idp = new KeycloakAdmin({
      issuer: config.oidcIssuer,
      clientId: config.keycloakProvisionerClientId ?? 'hcn-provisioner',
      clientSecret: config.keycloakProvisionerSecret,
    })
    await seedStaging(db, idp, config)
    console.log(`history_plan submissions=${stagingSubmissions} observations=${stagingObservations}`)
  } else if (command === 'verify-files') {
    const rows = await db.selectFrom('files').select(['id', 'storage_key', 'sha256']).execute()
    let missing = 0
    let mismatch = 0
    for (const row of rows) {
      const path = `${process.env.FILE_STORAGE_DIR ?? '/data/files'}/${row.storage_key}`
      let bytes: Buffer
      try {
        bytes = readFileSync(path)
      } catch {
        missing += 1
        continue
      }
      if (createHash('sha256').update(bytes).digest('hex') !== row.sha256) mismatch += 1
    }
    const links = await db.selectFrom('submission_version_files').select(['file_id']).execute()
    console.log(`files=${rows.length} missing=${missing} mismatch=${mismatch} submission_files=${links.length}`)
    if (missing > 0 || mismatch > 0) process.exit(1)
  } else {
    console.error('Lệnh: bootstrap-school | seed-curriculum | grant-reviewer | revoke-reviewer | seed-staging | verify-files')
    process.exit(1)
  }
} finally {
  await db.destroy()
}

async function userIdByUsername(idp: KeycloakAdmin, username: string): Promise<string> {
  const found = await idp.findByUsername(username)
  if (!found) {
    console.error('Không tìm thấy người dùng trên IdP')
    process.exit(1)
  }
  const user = await db.selectFrom('users').select(['id']).where('oidc_subject', '=', found.id).executeTakeFirst()
  if (!user) {
    console.error('Người dùng chưa có trong cơ sở dữ liệu')
    process.exit(1)
  }
  return user.id
}
