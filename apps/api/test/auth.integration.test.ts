import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { sql } from 'kysely'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb, type Database } from '@hcn/db'
import type { Kysely } from 'kysely'
import { personas, schools, seedIdentity } from '@hcn/testkit/identity'
import { startFakeIdp, type FakeIdp } from '@hcn/testkit/idp'
import { startPostgres18, type Postgres18 } from '@hcn/testkit'
import type { AppConfig } from '../src/config.ts'
import { buildApp } from '../src/server.ts'
import type { FastifyInstance } from 'fastify'
import type { DestinationStream } from 'pino'

function commandOk(command: string, args: string[]): boolean {
  try {
    execFileSync(command, args, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const ready = commandOk('docker', ['info']) && commandOk('dbmate', ['--version'])
if (process.env.CI === 'true' && !ready) throw new Error('Job CI cần Docker và dbmate để chạy kiểm thử xác thực')

const appOrigin = 'http://127.0.0.1:4319'
const clientSecret = 'test-secret-hcn-web'

function cookieLines(header: string | string[] | undefined): string[] {
  if (!header) return []
  return Array.isArray(header) ? header : [header]
}

function cookieValue(header: string | string[] | undefined, name: string): string | undefined {
  for (const line of cookieLines(header)) {
    const pair = line.split(';')[0] ?? ''
    if (pair.startsWith(`${name}=`)) return decodeURIComponent(pair.slice(name.length + 1))
  }
  return undefined
}

async function followToCallback(start: string): Promise<URL> {
  let current = start
  const jar = new Map<string, string>()
  for (let hop = 0; hop < 8; hop += 1) {
    const response = await fetch(current, {
      redirect: 'manual',
      headers: { cookie: [...jar].map(([key, value]) => `${key}=${value}`).join('; ') },
    })
    for (const line of response.headers.getSetCookie()) {
      const pair = line.split(';')[0] ?? ''
      const eq = pair.indexOf('=')
      if (eq > 0) jar.set(pair.slice(0, eq), pair.slice(eq + 1))
    }
    const location = response.headers.get('location')
    if (!location) throw new Error(`IdP trả ${response.status} mà không chuyển hướng`)
    const next = new URL(location, current)
    if (next.pathname === '/auth/callback') return next
    current = next.toString()
  }
  throw new Error('IdP không trả về /auth/callback')
}

describe.skipIf(!ready)('xác thực M1', () => {
  let postgres: Postgres18
  let db: Kysely<Database>
  let idp: FakeIdp
  let app: FastifyInstance
  let logs: string[]
  const logStream: DestinationStream = {
    write(message: string) {
      logs.push(message)
    },
  }

  const config = (): AppConfig => ({
    appOrigin,
    databaseUrl: db ? 'unused' : 'unused',
    oidcIssuer: idp.issuer,
    oidcClientId: 'hcn-web',
    oidcClientSecret: clientSecret,
    cookieSecret: 'test-cookie-secret-with-32-characters',
    sessionTtlHours: 12,
    sessionMaxDays: 7,
    trustProxy: [],
    port: 4319,
  })

  beforeAll(async () => {
    postgres = await startPostgres18()
    const cloned = await postgres.cloneDatabase('auth')
    db = createDb(cloned.url)
    idp = await startFakeIdp({
      clientId: 'hcn-web',
      clientSecret,
      redirectUri: `${appOrigin}/auth/callback`,
    })
    logs = []
    app = await buildApp({
      config: { ...config(), databaseUrl: cloned.url, oidcIssuer: idp.issuer },
      db,
      logStream,
    })
  }, 300_000)

  beforeEach(async () => {
    logs = []
    await sql`TRUNCATE sessions, audit_log`.execute(db)
    await seedIdentity(db, { issuer: idp.issuer })
  })

  afterAll(async () => {
    await app?.close()
    await db?.destroy()
    await idp?.stop()
    await postgres?.stop()
  })

  async function login(subject: string, returnTo = '/hoc', extraCookie = ''): Promise<{ response: Awaited<ReturnType<FastifyInstance['inject']>>; sid?: string }> {
    idp.loginAs(subject)
    const start = await app.inject({ method: 'GET', url: `/auth/login?returnTo=${encodeURIComponent(returnTo)}` })
    const oidc = cookieValue(start.headers['set-cookie'], 'hcn_oidc')
    expect(start.statusCode).toBe(302)
    expect(oidc).toBeTruthy()
    const callbackUrl = await followToCallback(start.headers.location ?? '')
    const cookie = [`hcn_oidc=${oidc}`, extraCookie].filter(Boolean).join('; ')
    const response = await app.inject({
      method: 'GET',
      url: `${callbackUrl.pathname}${callbackUrl.search}`,
      headers: { cookie },
    })
    const sid = cookieValue(response.headers['set-cookie'], 'hcn_sid')
    return sid ? { response, sid } : { response }
  }

  async function auditCount(): Promise<number> {
    const row = await sql<{ n: number }>`SELECT count(*)::int AS n FROM audit_log`.execute(db)
    return row.rows[0]?.n ?? 0
  }

  it('SEC-02 thiếu token, sai token, sai Origin, thiếu Origin → 403 CSRF_FAILED và không ghi audit', async () => {
    const { sid } = await login(personas.gvLan.subject)
    expect(sid).toBeTruthy()
    const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: `hcn_sid=${sid}` } })
    const csrf = me.json().csrfToken as string
    const before = await auditCount()
    const body = { schoolId: schools.an.id, role: 'guardian' }
    const cases = [
      { headers: { cookie: `hcn_sid=${sid}`, origin: appOrigin } },
      { headers: { cookie: `hcn_sid=${sid}`, origin: appOrigin, 'x-csrf-token': 'sai-token' } },
      { headers: { cookie: `hcn_sid=${sid}`, origin: 'https://evil.example', 'x-csrf-token': csrf } },
      { headers: { cookie: `hcn_sid=${sid}`, 'x-csrf-token': csrf } },
    ]
    for (const item of cases) {
      const response = await app.inject({ method: 'POST', url: '/api/v1/me/context', headers: item.headers, payload: body })
      expect(response.statusCode).toBe(403)
      expect(response.json().error.code).toBe('CSRF_FAILED')
    }
    expect(await auditCount()).toBe(before)
  })

  it('SEC-03 cookie hcn_sid có HttpOnly, Secure, SameSite=Lax và không có Domain', async () => {
    const { response } = await login(personas.hsMinh.subject)
    const line = cookieLines(response.headers['set-cookie']).find((item) => item.startsWith('hcn_sid='))
    expect(line).toBeTruthy()
    expect(line).toMatch(/HttpOnly/i)
    expect(line).toMatch(/Secure/)
    expect(line).toMatch(/SameSite=Lax/i)
    expect(line?.toLowerCase().includes('domain=')).toBe(false)
  })

  it('SEC-04 cookie cũ vào callback bị thu hồi và cookie mới khác cookie cũ', async () => {
    const first = await login(personas.gvLan.subject)
    expect(first.sid).toBeTruthy()
    const oldHash = createHash('sha256').update(first.sid ?? '').digest('hex')
    const second = await login(personas.gvLan.subject, '/hoc', `hcn_sid=${first.sid}`)
    expect(second.sid).toBeTruthy()
    expect(second.sid).not.toBe(first.sid)
    const row = await sql<{ revoked_at: Date | null }>`SELECT revoked_at FROM sessions WHERE id_hash = ${oldHash}`.execute(db)
    expect(row.rows[0]?.revoked_at).toBeTruthy()
  })

  it('SEC-10 đổi sang vai trò hoặc trường không có → 403; gv.lan.ph đổi teacher sang guardian → 200', async () => {
    const deniedGuardian = await login(personas.gvLan.subject)
    const deniedMe = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: `hcn_sid=${deniedGuardian.sid}` } })
    const deniedCsrf = deniedMe.json().csrfToken as string
    const teacherOnly = await app.inject({
      method: 'POST',
      url: '/api/v1/me/context',
      headers: { cookie: `hcn_sid=${deniedGuardian.sid}`, origin: appOrigin, 'x-csrf-token': deniedCsrf },
      payload: { schoolId: schools.an.id, role: 'guardian' },
    })
    expect(teacherOnly.statusCode).toBe(403)
    const { sid } = await login(personas.gvLanPh.subject)
    const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: `hcn_sid=${sid}` } })
    const csrf = me.json().csrfToken as string
    const headers = { cookie: `hcn_sid=${sid}`, origin: appOrigin, 'x-csrf-token': csrf }
    const deniedRole = await app.inject({
      method: 'POST',
      url: '/api/v1/me/context',
      headers,
      payload: { schoolId: schools.an.id, role: 'student' },
    })
    expect(deniedRole.statusCode).toBe(403)
    expect(deniedRole.json().error.code).toBe('FORBIDDEN')
    const deniedSchool = await app.inject({
      method: 'POST',
      url: '/api/v1/me/context',
      headers,
      payload: { schoolId: schools.binh.id, role: 'teacher' },
    })
    expect(deniedSchool.statusCode).toBe(403)
    const switched = await app.inject({
      method: 'POST',
      url: '/api/v1/me/context',
      headers,
      payload: { schoolId: schools.an.id, role: 'guardian' },
    })
    expect(switched.statusCode).toBe(200)
    expect(switched.json().activeContext).toEqual({ schoolId: schools.an.id, role: 'guardian' })
    const back = await app.inject({
      method: 'POST',
      url: '/api/v1/me/context',
      headers,
      payload: { schoolId: schools.an.id, role: 'teacher' },
    })
    expect(back.statusCode).toBe(200)
    expect(back.json().activeContext.role).toBe('teacher')
  })

  it.each(['/\\evil', 'https://evil', '//evil', '/%2F%2Fevil'])('SEC-11 returnTo %s quay về /', async (returnTo) => {
    const { response } = await login(personas.hsMinh.subject, returnTo)
    expect(response.statusCode).toBe(302)
    expect(response.headers.location).toBe(`${appOrigin}/`)
  })

  it('INV-01 body chứa userId, role, schoolId không đổi được danh tính', async () => {
    const { sid } = await login(personas.gvLan.subject)
    const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: `hcn_sid=${sid}` } })
    const csrf = me.json().csrfToken as string
    const headers = { cookie: `hcn_sid=${sid}`, origin: appOrigin, 'x-csrf-token': csrf }
    const rejected = await app.inject({
      method: 'POST',
      url: '/api/v1/me/context',
      headers,
      payload: { schoolId: schools.an.id, role: 'guardian', userId: personas.hsMinh.subject },
    })
    expect(rejected.statusCode).toBe(422)
    expect(rejected.json().error.code).toBe('VALIDATION_FAILED')
    const forbidden = await app.inject({
      method: 'POST',
      url: '/api/v1/me/context',
      headers,
      payload: { schoolId: schools.binh.id, role: 'admin' },
    })
    expect(forbidden.statusCode).toBe(403)
    const again = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: `hcn_sid=${sid}` } })
    expect(again.json().userId).toBe(personas.gvLan.subject)
    expect(again.json().activeContext).toEqual({ schoolId: schools.an.id, role: 'teacher' })
  })

  it('INV-13 log đăng nhập không chứa cookie, code, id_token, csrf token', async () => {
    const { sid } = await login(personas.gvLan.subject)
    const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: `hcn_sid=${sid}` } })
    const csrf = me.json().csrfToken as string
    const text = logs.join('\n')
    expect(text).not.toContain(sid)
    expect(text).not.toContain(csrf)
    expect(text).not.toContain('eyJ')
    expect(text).not.toMatch(/[?&]code=/)
  })

  it('user.chua.cap nhận 403 và trang chưa được cấp quyền', async () => {
    const { response } = await login(personas.userChuaCap.subject)
    expect(response.statusCode).toBe(403)
    expect(response.body).toContain('Tài khoản chưa được nhà trường cấp quyền')
    expect(response.body).toContain('Đăng xuất')
  })

  it('user.khoa bị 401 ở request kế tiếp sau khi khóa', async () => {
    await sql`UPDATE users SET status = 'active' WHERE id = ${personas.userKhoa.subject}`.execute(db)
    const { sid } = await login(personas.userKhoa.subject)
    expect(sid).toBeTruthy()
    await sql`UPDATE users SET status = 'locked' WHERE id = ${personas.userKhoa.subject}`.execute(db)
    const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: `hcn_sid=${sid}` } })
    expect(me.statusCode).toBe(401)
    expect(me.json().error.code).toBe('UNAUTHENTICATED')
    const hash = createHash('sha256').update(sid ?? '').digest('hex')
    const row = await sql<{ revoked_at: Date | null }>`SELECT revoked_at FROM sessions WHERE id_hash = ${hash}`.execute(db)
    expect(row.rows[0]?.revoked_at).toBeTruthy()
  })

  it('phiên hết hạn và phiên quá 7 ngày trả 401', async () => {
    const token = 'expired-session-token-value'
    const hash = createHash('sha256').update(token).digest('hex')
    await sql`
      INSERT INTO sessions (id_hash, user_id, csrf_token, context, created_at, last_seen_at, expires_at)
      VALUES (${hash}, ${personas.hsMinh.subject}, 'csrf', ${JSON.stringify({ school_id: schools.an.id, role: 'student' })}::jsonb, now(), now(), now() - interval '1 minute')
    `.execute(db)
    const expired = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: `hcn_sid=${token}` } })
    expect(expired.statusCode).toBe(401)

    const oldToken = 'aged-session-token-value'
    const oldHash = createHash('sha256').update(oldToken).digest('hex')
    await sql`
      INSERT INTO sessions (id_hash, user_id, csrf_token, context, created_at, last_seen_at, expires_at)
      VALUES (${oldHash}, ${personas.hsMinh.subject}, 'csrf', ${JSON.stringify({ school_id: schools.an.id, role: 'student' })}::jsonb, now() - interval '8 days', now(), now() + interval '1 hour')
    `.execute(db)
    const aged = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: `hcn_sid=${oldToken}` } })
    expect(aged.statusCode).toBe(401)
  })

  it('rate-limit /auth/login lần thứ 21 trong một phút trả 429 kèm Retry-After', async () => {
    const limited = await buildApp({
      config: { ...config(), databaseUrl: 'postgres://unused', oidcIssuer: idp.issuer },
      db,
    })
    let last: Awaited<ReturnType<FastifyInstance['inject']>> | undefined
    for (let attempt = 0; attempt < 21; attempt += 1) {
      last = await limited.inject({ method: 'GET', url: '/auth/login' })
    }
    expect(last?.statusCode).toBe(429)
    expect(last?.json().error.code).toBe('RATE_LIMITED')
    expect(last?.headers['retry-after']).toBeTruthy()
    await limited.close()
  })
})
