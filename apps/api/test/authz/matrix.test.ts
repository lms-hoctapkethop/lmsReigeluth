import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { sql } from 'kysely'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb, type Database } from '@hcn/db'
import type { Kysely } from 'kysely'
import { can, type Action } from '@hcn/domain'
import {
  assignments,
  classes,
  enrollments,
  guardianLinks,
  offerings,
  personas,
  schools,
  seedIdentity,
} from '@hcn/testkit/identity'
import { startPostgres18, type Postgres18 } from '@hcn/testkit'
import { FakeIdpAdmin } from '@hcn/testkit/idp-admin'
import type { FastifyInstance } from 'fastify'
import type { AppConfig } from '../../src/config.ts'
import { buildApp } from '../../src/server.ts'

function commandOk(command: string, args: string[]): boolean {
  try {
    execFileSync(command, args, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const ready = commandOk('docker', ['info']) && commandOk('dbmate', ['--version'])
if (process.env.CI === 'true' && !ready) throw new Error('Job CI cần Docker và dbmate để chạy kiểm thử tổ chức')

const appOrigin = 'http://127.0.0.1:4319'
const roles = ['admin', 'teacher', 'student', 'guardian'] as const
const schoolsKeys = ['an', 'binh'] as const
const implemented = ['org.manage', 'guardian_link.verify', 'guardian_link.revoke'] as const
const later: [Action, string][] = [
  ['curriculum.read', 'M3'],
  ['curriculum.propose', 'M3'],
  ['curriculum.review', 'M3'],
  ['module.create', 'M4'],
  ['module.edit', 'M4'],
  ['module.publish', 'M4'],
  ['release.create', 'M5'],
  ['release.change', 'M5'],
  ['release.read_learner', 'M5'],
  ['progress.write', 'M5'],
  ['submission.draft', 'M5'],
  ['submission.create', 'M5'],
  ['submission.read', 'M5'],
  ['attempt.*', 'M6'],
  ['review.*', 'M7'],
  ['review.read_published', 'M7'],
  ['decision.supersede', 'M7'],
  ['needs.read', 'M7'],
  ['heatmap.read', 'M7'],
  ['family_support.*', 'M7'],
]

describe('ma trận quyền M2', () => {
  for (const action of implemented) {
    for (const school of schoolsKeys) {
      for (const role of roles) {
        it(`${action} ${role} trường ${school}`, () => {
          const decision = can({ userId: personas.adminA.subject, schoolId: schools[school].id, roles: [role] }, action, {})
          expect(decision.allow).toBe(role === 'admin')
        })
      }
    }
  }
  for (const [action, milestone] of later) {
    for (const role of roles) it.todo(`${action} ${role} ${milestone}`)
  }
})

describe.skipIf(!ready)('HTTP tổ chức hai trường', () => {
  let postgres: Postgres18
  let db: Kysely<Database>
  let app: FastifyInstance
  const issuer = 'http://idp.test/realms/hcn'
  const config = (url: string): AppConfig => ({
    appOrigin,
    databaseUrl: url,
    oidcIssuer: issuer,
    oidcClientId: 'hcn-web',
    oidcClientSecret: 'test-secret-hcn-web',
    cookieSecret: 'test-cookie-secret-with-32-characters',
    sessionTtlHours: 12,
    sessionMaxDays: 7,
    trustProxy: [],
    port: 4319,
  })

  beforeAll(async () => {
    postgres = await startPostgres18()
    const cloned = await postgres.cloneDatabase('org')
    db = createDb(cloned.url)
    const idp = new FakeIdpAdmin()
    for (const persona of Object.values(personas)) {
      if (persona.username === personas.userChuaCap.username) continue
      idp.users.set(persona.subject, { id: persona.subject, username: persona.username, enabled: persona.status === 'active', password: 'khong-dung' })
    }
    app = await buildApp({ config: config(cloned.url), db, idpAdmin: idp })
  }, 300_000)

  beforeEach(async () => {
    await sql`
      TRUNCATE offering_enrollments, teacher_assignments, offering_class_links, offerings, courses,
        class_memberships, admin_classes, academic_years, guardian_links, curriculum_reviewers,
        school_memberships, outbox_events, idempotency_keys, sessions, audit_log
      RESTART IDENTITY CASCADE
    `.execute(db)
    await seedIdentity(db, { issuer })
  })

  afterAll(async () => {
    await app?.close()
    await db?.destroy()
    await postgres?.stop()
  })

  async function session(userId: string, schoolId: string, role: string): Promise<{ cookie: string; csrf: string }> {
    const token = randomUUID()
    const csrf = randomUUID()
    const hash = createHash('sha256').update(token).digest('hex')
    await sql`
      INSERT INTO sessions (id_hash, user_id, csrf_token, context, created_at, last_seen_at, expires_at)
      VALUES (${hash}, ${userId}, ${csrf}, ${JSON.stringify({ school_id: schoolId, role })}::jsonb, now(), now(), now() + interval '2 hours')
    `.execute(db)
    return { cookie: `hcn_sid=${token}`, csrf }
  }

  function headers(auth: { cookie: string; csrf: string }, write = false): Record<string, string> {
    return write ? { cookie: auth.cookie, origin: appOrigin, 'x-csrf-token': auth.csrf } : { cookie: auth.cookie }
  }

  function sameError(left: { error: { request_id: string } }, right: { error: { request_id: string } }): void {
    const a = { ...left.error, request_id: 'same' }
    const b = { ...right.error, request_id: 'same' }
    expect(a).toEqual(b)
  }

  it('A01 gv.lan chỉ thấy Tin10A1, Tin10A2, Toán10A3 và gọi offering của gv.hung thì 404', async () => {
    const auth = await session(personas.gvLan.subject, schools.an.id, 'teacher')
    const list = await app.inject({ method: 'GET', url: '/api/v1/offerings', headers: headers(auth) })
    expect(list.statusCode).toBe(200)
    const titles = (list.json() as { title: string }[]).map((item) => item.title).sort()
    expect(titles).toEqual(['Tin10A1', 'Tin10A2', 'Toán10A3'])
    const hidden = await app.inject({ method: 'GET', url: `/api/v1/offerings/${offerings.toan7a4.id}`, headers: headers(auth) })
    expect(hidden.statusCode).toBe(404)
    expect(hidden.json().error.code).toBe('NOT_FOUND')
  })

  it('AC02 GV gọi API offering không được phân công thì 404', async () => {
    const auth = await session(personas.gvLan.subject, schools.an.id, 'teacher')
    const response = await app.inject({ method: 'GET', url: `/api/v1/offerings/${offerings.tin11a2.id}`, headers: headers(auth) })
    expect(response.statusCode).toBe(404)
    expect(response.json().error.code).toBe('NOT_FOUND')
  })

  it('AC03 SEC-05 thu hồi liên kết, gỡ phân công và khóa user có hiệu lực ở request kế tiếp', async () => {
    const admin = await session(personas.adminA.subject, schools.an.id, 'admin')
    const parent = await session(personas.phMinh.subject, schools.an.id, 'guardian')
    const before = await app.inject({ method: 'GET', url: '/api/v1/me/children', headers: headers(parent) })
    expect((before.json() as { learnerId: string }[]).map((item) => item.learnerId)).toContain(personas.hsMinh.subject)
    const revoked = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/guardian-links/${guardianLinks.phMinhMinh.id}/revoke`,
      headers: headers(admin, true),
      payload: { reason: 'Không còn giám hộ' },
    })
    expect(revoked.statusCode).toBe(200)
    const after = await app.inject({ method: 'GET', url: `/api/v1/children/${personas.hsMinh.subject}/overview`, headers: headers(parent) })
    expect(after.statusCode).toBe(404)
    const list = await app.inject({ method: 'GET', url: '/api/v1/me/children', headers: headers(parent) })
    expect((list.json() as { learnerId: string }[]).map((item) => item.learnerId)).not.toContain(personas.hsMinh.subject)

    const teacher = await session(personas.gvHung.subject, schools.an.id, 'teacher')
    const visible = await app.inject({ method: 'GET', url: `/api/v1/offerings/${offerings.toan7a4.id}`, headers: headers(teacher) })
    expect(visible.statusCode).toBe(200)
    const ended = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/offerings/${offerings.toan7a4.id}/assignments/${assignments.hungToan7a4.id}/end`,
      headers: headers(admin, true),
    })
    expect(ended.statusCode).toBe(200)
    const gone = await app.inject({ method: 'GET', url: `/api/v1/offerings/${offerings.toan7a4.id}`, headers: headers(teacher) })
    expect(gone.statusCode).toBe(404)

    const student = await session(personas.hsAn.subject, schools.an.id, 'student')
    const locked = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/users/${personas.hsAn.subject}/lock`,
      headers: headers(admin, true),
      payload: { reason: 'Khóa kiểm thử' },
    })
    expect(locked.statusCode).toBe(200)
    const next = await app.inject({ method: 'GET', url: '/api/v1/me', headers: headers(student) })
    expect(next.statusCode).toBe(401)
  })

  it('SEC-01 admin.a dùng id offering, lớp, user, liên kết của trường B thì 404', async () => {
    const admin = await session(personas.adminA.subject, schools.an.id, 'admin')
    const cases = [
      { method: 'GET' as const, url: `/api/v1/admin/offerings/${offerings.tin10b1.id}` },
      { method: 'GET' as const, url: `/api/v1/admin/classes/${classes.b10b1.id}/learners` },
      { method: 'GET' as const, url: `/api/v1/offerings/${offerings.tin10b1.id}` },
    ]
    for (const item of cases) {
      const response = await app.inject({ method: item.method, url: item.url, headers: headers(admin) })
      expect(response.statusCode).toBe(404)
      expect(response.json().error.code).toBe('NOT_FOUND')
    }
    const lock = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/users/${personas.hsB.subject}/lock`,
      headers: headers(admin, true),
      payload: { reason: 'Không được' },
    })
    expect(lock.statusCode).toBe(404)
    const verify = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/guardian-links/${guardianLinks.bLink.id}/verify`,
      headers: headers(admin, true),
    })
    expect(verify.statusCode).toBe(404)
  })

  it('SEC-18 body 404 của id không tồn tại và của trường khác giống nhau ngoài request_id', async () => {
    const admin = await session(personas.adminA.subject, schools.an.id, 'admin')
    const missing = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/offerings/00000000-0000-4000-8000-000000000099',
      headers: headers(admin),
    })
    const other = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/offerings/${offerings.tin10b1.id}`,
      headers: headers(admin),
    })
    expect(missing.statusCode).toBe(404)
    expect(other.statusCode).toBe(404)
    expect(missing.json().error.request_id).not.toBe(other.json().error.request_id)
    sameError(missing.json(), other.json())
  })

  it('A03 chuyển hs.minh từ 10A1 sang 10A2 giữa năm giữ ghi danh Tin10A1', async () => {
    const admin = await session(personas.adminA.subject, schools.an.id, 'admin')
    const moved = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/classes/transfer',
      headers: headers(admin, true),
      payload: { learnerId: personas.hsMinh.subject, toClassId: classes.a10a2.id, onDate: '2026-12-01' },
    })
    expect(moved.statusCode).toBe(200)
    const ranges = await sql<{ class_id: string; start: string; end: string }>`
      SELECT class_id, lower(valid)::text AS start, upper(valid)::text AS end
      FROM class_memberships
      WHERE learner_id = ${personas.hsMinh.subject}
      ORDER BY lower(valid)
    `.execute(db)
    expect(ranges.rows).toEqual([
      { class_id: classes.a10a1.id, start: '2026-09-01', end: '2026-12-01' },
      { class_id: classes.a10a2.id, start: '2026-12-01', end: '2027-06-01' },
    ])
    const enrollment = await sql<{ status: string }>`
      SELECT status FROM offering_enrollments WHERE id = ${enrollments.minhTin10a1.id}
    `.execute(db)
    expect(enrollment.rows[0]?.status).toBe('active')
  })

  it('GV trong trường gọi lệnh quản trị thì 403, admin trường khác thì 404', async () => {
    const teacher = await session(personas.gvLan.subject, schools.an.id, 'teacher')
    const forbidden = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/academic-years',
      headers: headers(teacher, true),
      payload: { code: '2027-2028', startsOn: '2027-09-01', endsOn: '2028-05-31' },
    })
    expect(forbidden.statusCode).toBe(403)
    const adminB = await session(personas.gvB.subject, schools.binh.id, 'teacher')
    const missing = await app.inject({
      method: 'GET',
      url: `/api/v1/offerings/${offerings.tin10a1.id}`,
      headers: headers(adminB),
    })
    expect(missing.statusCode).toBe(404)
  })
})
