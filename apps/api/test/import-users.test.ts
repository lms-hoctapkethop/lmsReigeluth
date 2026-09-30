import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { sql } from 'kysely'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb, type Database } from '@hcn/db'
import type { Kysely } from 'kysely'
import { personas, schools, seedIdentity } from '@hcn/testkit/identity'
import { FakeIdpAdmin } from '@hcn/testkit/idp-admin'
import { startPostgres18, type Postgres18 } from '@hcn/testkit'
import type { FastifyInstance } from 'fastify'
import type { DestinationStream } from 'pino'
import type { AppConfig } from '../src/config.ts'
import { buildApp } from '../src/server.ts'

function commandOk(command: string, args: string[]): boolean {
  try {
    execFileSync(command, args, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const ready = commandOk('docker', ['info']) && commandOk('dbmate', ['--version'])
if (process.env.CI === 'true' && !ready) throw new Error('Job CI cần Docker và dbmate để chạy kiểm thử nhập tài khoản')

const appOrigin = 'http://127.0.0.1:4319'

function csv(rows: string[]): string {
  return ['ho_ten,ma_dinh_danh,vai_tro,lop,email,ma_hs_con', ...rows].join('\n')
}

function multipart(body: string): { payload: string; contentType: string } {
  const boundary = '----hcnboundary'
  const payload = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="file"; filename="users.csv"',
    'Content-Type: text/csv',
    '',
    body,
    `--${boundary}--`,
    '',
  ].join('\r\n')
  return { payload, contentType: `multipart/form-data; boundary=${boundary}` }
}

describe.skipIf(!ready)('importUsers', () => {
  let postgres: Postgres18
  let db: Kysely<Database>
  let app: FastifyInstance
  let idp: FakeIdpAdmin
  let logs: string[]
  const issuer = 'http://idp.test/realms/hcn'
  const logStream: DestinationStream = { write(message: string) { logs.push(message) } }

  beforeAll(async () => {
    postgres = await startPostgres18()
    const cloned = await postgres.cloneDatabase('import')
    db = createDb(cloned.url)
    idp = new FakeIdpAdmin()
    const config: AppConfig = {
      appOrigin,
      databaseUrl: cloned.url,
      oidcIssuer: issuer,
      oidcClientId: 'hcn-web',
      oidcClientSecret: 'test-secret-hcn-web',
      cookieSecret: 'test-cookie-secret-with-32-characters',
      sessionTtlHours: 12,
      sessionMaxDays: 7,
      trustProxy: [],
      port: 4319,
    }
    logs = []
    app = await buildApp({ config, db, idpAdmin: idp, logStream })
  }, 300_000)

  beforeEach(async () => {
    logs = []
    idp.reset()
    for (const persona of Object.values(personas)) {
      if (persona.username === personas.userChuaCap.username) continue
      idp.users.set(persona.subject, { id: persona.subject, username: persona.username, enabled: true, password: 'khong-dung' })
    }
    await sql`
      TRUNCATE offering_enrollments, teacher_assignments, offering_class_links, offerings, courses,
        class_memberships, admin_classes, academic_years, guardian_links, curriculum_reviewers,
        school_memberships, outbox_events, idempotency_keys, sessions, audit_log
      RESTART IDENTITY
    `.execute(db)
    await sql`DELETE FROM users`.execute(db)
    await seedIdentity(db, { issuer })
  })

  afterAll(async () => {
    await app?.close()
    await db?.destroy()
    await postgres?.stop()
  })

  async function admin(): Promise<{ cookie: string; csrf: string }> {
    const token = randomUUID()
    const csrf = randomUUID()
    const hash = createHash('sha256').update(token).digest('hex')
    await sql`
      INSERT INTO sessions (id_hash, user_id, csrf_token, context, created_at, last_seen_at, expires_at)
      VALUES (${hash}, ${personas.adminA.subject}, ${csrf}, ${JSON.stringify({ school_id: schools.an.id, role: 'admin' })}::jsonb, now(), now(), now() + interval '2 hours')
    `.execute(db)
    return { cookie: `hcn_sid=${token}`, csrf }
  }

  async function upload(auth: { cookie: string; csrf: string }, body: string, key: string) {
    const form = multipart(body)
    return app.inject({
      method: 'POST',
      url: '/api/v1/admin/users/import',
      headers: {
        cookie: auth.cookie,
        origin: appOrigin,
        'x-csrf-token': auth.csrf,
        'idempotency-key': key,
        'content-type': form.contentType,
      },
      payload: form.payload,
    })
  }

  it('importUsers dòng trùng, lỗi giữa lô, phát lại cùng key không tạo trùng và passwordsRedacted', async () => {
    const auth = await admin()
    const duplicate = csv(['An A,hs.trung,student,10A1,,', 'An B,hs.trung,student,10A1,,'])
    const first = await upload(auth, duplicate, 'import-duplicate-key')
    expect(first.statusCode).toBe(200)
    expect(first.headers['cache-control']).toBe('no-store')
    const created = first.json().created as { temporaryPassword: string; username: string }[]
    expect(created).toHaveLength(1)
    expect(first.json().passwordsRedacted).toBe(false)
    expect(first.json().errors[0].code).toBe('DUPLICATE_IN_FILE')
    const password = created[0]?.temporaryPassword ?? ''
    expect(password).toHaveLength(12)

    const replay = await upload(auth, duplicate, 'import-duplicate-key')
    expect(replay.statusCode).toBe(200)
    expect(replay.json().passwordsRedacted).toBe(true)
    expect(JSON.stringify(replay.json())).not.toContain('temporaryPassword')
    const count = await sql<{ n: number }>`SELECT count(*)::int AS n FROM users WHERE display_name = 'An A'`.execute(db)
    expect(count.rows[0]?.n).toBe(1)

    const stored = await sql<{ body: string }>`SELECT response_body::text AS body FROM idempotency_keys`.execute(db)
    const audit = await sql<{ body: string }>`SELECT details::text AS body FROM audit_log`.execute(db)
    const haystack = `${logs.join('\n')}\n${stored.rows.map((row) => row.body).join('\n')}\n${audit.rows.map((row) => row.body).join('\n')}`
    expect(haystack).not.toContain(password)

    idp.reset()
    const rows = Array.from({ length: 60 }, (_, index) => `HS ${index + 1},hs.lot.${index + 1},student,,,`)
    idp.failAtCall = { call: 53, kind: 'timeout' }
    const batch = await upload(auth, csv(rows), 'import-batch-key')
    expect(batch.statusCode).toBe(200)
    const errors = batch.json().errors as { row: number; code: string }[]
    expect(errors.some((item) => item.row === 54 && item.code === 'IDP_TIMEOUT')).toBe(true)
    expect((batch.json().created as unknown[]).length).toBe(59)

    idp.reset()
    idp.failAtCall = { call: 1, kind: 'exists' }
    const exists = await upload(auth, csv(['Đã có,hs.co,teacher,,,']), 'import-exists-key')
    expect(exists.json().errors[0].code).toBe('USER_EXISTS')

    idp.reset()
    idp.failAtCall = { call: 1, kind: 'orphan' }
    const orphan = await upload(auth, csv(['Mồ côi,hs.mo-coi,teacher,,,']), 'import-orphan-key')
    expect(orphan.json().errors[0].code).toBe('ORPHAN')
    expect([...idp.users.keys()].some((id) => id.startsWith('not-a-uuid-'))).toBe(true)
  })

  it('importUsers quá 5 lần một giờ thì 429', async () => {
    const limited = await buildApp({
      config: {
        appOrigin,
        databaseUrl: 'postgres://unused',
        oidcIssuer: issuer,
        oidcClientId: 'hcn-web',
        oidcClientSecret: 'test-secret-hcn-web',
        cookieSecret: 'test-cookie-secret-with-32-characters',
        sessionTtlHours: 12,
        sessionMaxDays: 7,
        trustProxy: [],
        port: 4319,
      },
      db,
      idpAdmin: new FakeIdpAdmin(),
    })
    const auth = await admin()
    let last: Awaited<ReturnType<FastifyInstance['inject']>> | undefined
    for (let index = 0; index < 6; index += 1) {
      const form = multipart(csv([`HS ${index},hs.rate.${index},student,,,`]))
      last = await limited.inject({
        method: 'POST',
        url: '/api/v1/admin/users/import',
        headers: {
          cookie: auth.cookie,
          origin: appOrigin,
          'x-csrf-token': auth.csrf,
          'idempotency-key': `rate-key-${index}-ok`,
          'content-type': form.contentType,
        },
        payload: form.payload,
      })
    }
    expect(last?.statusCode).toBe(429)
    await limited.close()
  })

  it('resetTemporaryPassword đặt Cache-Control no-store và không ghi idempotency', async () => {
    const auth = await admin()
    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/users/${personas.hsMinh.subject}/reset-password`,
      headers: { cookie: auth.cookie, origin: appOrigin, 'x-csrf-token': auth.csrf, 'idempotency-key': 'khong-dung-key' },
    })
    const second = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/users/${personas.hsMinh.subject}/reset-password`,
      headers: { cookie: auth.cookie, origin: appOrigin, 'x-csrf-token': auth.csrf },
    })
    expect(first.statusCode).toBe(200)
    expect(second.statusCode).toBe(200)
    expect(first.headers['cache-control']).toBe('no-store')
    expect(first.json().temporaryPassword).not.toBe(second.json().temporaryPassword)
    const keys = await sql<{ n: number }>`SELECT count(*)::int AS n FROM idempotency_keys`.execute(db)
    expect(keys.rows[0]?.n).toBe(0)
    const audit = await sql<{ body: string }>`SELECT details::text AS body FROM audit_log`.execute(db)
    expect(audit.rows.map((row) => row.body).join('\n')).not.toContain(first.json().temporaryPassword)
  })
})
