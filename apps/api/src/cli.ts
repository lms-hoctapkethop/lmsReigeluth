import { createDb } from '@hcn/db'
import { bootstrapSchool, seedCurriculum } from '@hcn/domain'
import { KeycloakAdmin } from './adapters/keycloak-admin.ts'
import { loadConfig } from './config.ts'

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
  } else {
    console.error('Lệnh: bootstrap-school | seed-curriculum')
    process.exit(1)
  }
} finally {
  await db.destroy()
}
