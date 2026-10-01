import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { sql } from 'kysely'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb, type Database } from '@hcn/db'
import type { Kysely } from 'kysely'
import { courses, offerings, personas, schools, seedIdentity } from '@hcn/testkit/identity'
import { startFakeClamd } from '@hcn/testkit/clamd'
import { startPostgres18, type Postgres18 } from '@hcn/testkit'
import type { FastifyInstance } from 'fastify'
import type { AppConfig } from '../src/config.ts'
import { buildApp } from '../src/server.ts'
import { processOutbox } from '../../worker/src/loop.ts'

function commandOk(command: string, args: string[]): boolean {
  try {
    execFileSync(command, args, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const ready = commandOk('docker', ['info']) && commandOk('dbmate', ['--version'])
if (process.env.CI === 'true' && !ready) throw new Error('Job CI cần Docker và dbmate để chạy học tập')

const appOrigin = 'http://127.0.0.1:4319'
const issuer = 'http://idp.test/realms/hcn'
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const eicar = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'

type Auth = { cookie: string; csrf: string }
type Role = 'teacher' | 'student' | 'guardian'

function rich(text: string) {
  return { format: 'hcn-rich/1', blocks: [{ type: 'paragraph', children: [{ text }] }] }
}

function multipart(filename: string, bytes: Buffer): { payload: Buffer; contentType: string } {
  const boundary = '----hcnboundary'
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`)
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`)
  return { payload: Buffer.concat([head, bytes, tail]), contentType: `multipart/form-data; boundary=${boundary}` }
}

describe.skipIf(!ready)('học tập M5', () => {
  let postgres: Postgres18
  let adminDb: Kysely<Database>
  let db: Kysely<Database>
  let app: FastifyInstance
  let storageDir: string
  let logs: string[]

  beforeAll(async () => {
    postgres = await startPostgres18()
    const cloned = await postgres.cloneDatabase('learning_api')
    adminDb = createDb(cloned.url)
    db = createDb(cloned.appUrl)
    storageDir = await mkdtemp(join(tmpdir(), 'hcn-files-'))
    logs = []
    const logStream = new Writable({
      write(chunk, _encoding, callback) {
        logs.push(String(chunk))
        callback()
      },
    })
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
    hcnEnv: 'development',
    metricsPort: 9464,
    backupMetricsFile: '/run/hcn-metrics/backup.prom',
    faultAfterCommit: null,
    }
    app = await buildApp({ config, db, storageDir, logStream })
  }, 300_000)

  beforeEach(async () => {
    delete process.env.HCN_NOW
    logs.length = 0
    await sql`
      TRUNCATE submission_version_files, submission_versions, submissions, activity_progress, content_files, files,
        release_schedule_changes, module_releases, path_releases, processed_events, outbox_events,
        option_misconceptions, question_kc_links, question_keys, question_items, assessment_versions,
        module_items, rubric_criteria, rubric_versions, module_versions, module_drafts, module_collaborators, modules,
        idempotency_keys, sessions, audit_log
      RESTART IDENTITY CASCADE
    `.execute(adminDb)
    await seedIdentity(adminDb, { issuer })
  })

  afterEach(() => {
    delete process.env.HCN_NOW
  })

  afterAll(async () => {
    await app?.close()
    await db?.destroy()
    await adminDb?.destroy()
    await postgres?.stop()
    if (storageDir) await rm(storageDir, { recursive: true, force: true })
  })

  async function session(userId: string, role: Role): Promise<Auth> {
    const token = randomUUID()
    const hash = createHash('sha256').update(token).digest('hex')
    const csrf = randomUUID()
    await sql`
      INSERT INTO sessions (id_hash, user_id, csrf_token, context, created_at, last_seen_at, expires_at)
      VALUES (${hash}, ${userId}, ${csrf}, ${JSON.stringify({ school_id: schools.an.id, role })}::jsonb, now(), now(), now() + interval '2 hours')
    `.execute(db)
    return { cookie: `hcn_sid=${token}`, csrf }
  }

  function headers(auth: Auth, extra: Record<string, string> = {}): Record<string, string> {
    return { cookie: auth.cookie, origin: appOrigin, 'x-csrf-token': auth.csrf, ...extra }
  }

  async function publishModule(auth: Auth, title: string, items: Record<string, unknown>[]): Promise<string> {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/modules',
      headers: headers(auth),
      payload: { courseId: courses.tin10.id, title, requirementIds: [] },
    })
    expect(created.statusCode).toBe(201)
    const moduleId = created.json().moduleId as string
    const saved = await app.inject({
      method: 'PUT',
      url: `/api/v1/modules/${moduleId}/draft`,
      headers: headers(auth, { 'if-match': 'W/"1"' }),
      payload: { schema: 'module-draft/1', title, requirementIds: [], items },
    })
    expect(saved.statusCode, saved.body).toBe(200)
    const published = await app.inject({
      method: 'POST',
      url: `/api/v1/modules/${moduleId}/versions`,
      headers: headers(auth, { 'idempotency-key': randomUUID() }),
      payload: { expectedRevision: 2, acknowledgements: [] },
    })
    expect(published.statusCode, published.body).toBe(201)
    return published.json().id as string
  }

  function assignmentItem(extra: Record<string, unknown> = {}) {
    return { clientKey: 'a', type: 'assignment', title: 'Nhiệm vụ', indent: 0, completion: 'submit', body: rich('Đề bài'), requirementIds: [], ...extra }
  }

  async function releaseOne(auth: Auth, versionId: string, schedule: Record<string, unknown>, key = randomUUID()) {
    return app.inject({
      method: 'POST',
      url: `/api/v1/offerings/${offerings.tin10a1.id}/path-releases`,
      headers: headers(auth, { 'idempotency-key': key }),
      payload: { title: 'Đợt 1', modules: [{ moduleVersionId: versionId, availableFrom: '2020-01-01T00:00:00.000Z', ...schedule }] },
    })
  }

  async function itemId(versionId: string, type: string): Promise<string> {
    const row = await sql<{ id: string }>`SELECT id FROM module_items WHERE module_version_id = ${versionId} AND item_type = ${type}`.execute(adminDb)
    const id = row.rows[0]?.id
    if (!id) throw new Error(`thiếu mục ${type}`)
    return id
  }

  async function upload(auth: Auth, filename: string, bytes: Buffer) {
    const body = multipart(filename, bytes)
    return app.inject({
      method: 'POST',
      url: '/api/v1/files',
      headers: headers(auth, { 'content-type': body.contentType }),
      payload: body.payload,
    })
  }

  async function saveDraft(auth: Auth, releaseId: string, target: string, revision: number, payload: Record<string, unknown>) {
    return app.inject({
      method: 'PUT',
      url: `/api/v1/module-releases/${releaseId}/items/${target}/submission/draft`,
      headers: headers(auth, { 'if-match': `W/"${String(revision)}"` }),
      payload,
    })
  }

  it('P1a-03 giao 2 module, module 2 sai khóa thì 422 và không ghi đợt', async () => {
    const teacher = await session(personas.gvLan.subject, 'teacher')
    const tin = await publishModule(teacher, 'Tin', [assignmentItem()])
    const wrongModule = randomUUID()
    const wrongVersion = randomUUID()
    await sql`
      INSERT INTO modules (id, school_id, course_id, owner_id)
      VALUES (${wrongModule}, ${schools.an.id}, ${courses.toan10.id}, ${personas.gvLan.subject})
    `.execute(adminDb)
    await sql`
      INSERT INTO module_versions (id, school_id, module_id, version_no, title, requirement_ids, coverage_report, digest, published_by)
      VALUES (${wrongVersion}, ${schools.an.id}, ${wrongModule}, 1, 'Toán', '{}', '{}', 'digest-toan', ${personas.gvLan.subject})
    `.execute(adminDb)
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/offerings/${offerings.tin10a1.id}/path-releases`,
      headers: headers(teacher, { 'idempotency-key': randomUUID() }),
      payload: {
        title: 'Hai module',
        modules: [
          { moduleVersionId: tin, availableFrom: '2020-01-01T00:00:00.000Z' },
          { moduleVersionId: wrongVersion, availableFrom: '2020-01-01T00:00:00.000Z' },
        ],
      },
    })
    expect(response.statusCode).toBe(422)
    expect(response.json().error.code).toBe('VALIDATION_FAILED')
    expect(response.json().error.details.reason).toBe('MODULE_COURSE')
    const paths = await sql<{ n: number }>`SELECT count(*)::int AS n FROM path_releases`.execute(adminDb)
    const modules = await sql<{ n: number }>`SELECT count(*)::int AS n FROM module_releases`.execute(adminDb)
    expect(paths.rows[0]?.n).toBe(0)
    expect(modules.rows[0]?.n).toBe(0)
  })

  it('P1a-04 cùng Idempotency-Key sau commit trả cùng receipt, khác body thì 409', async () => {
    const teacher = await session(personas.gvLan.subject, 'teacher')
    const versionId = await publishModule(teacher, 'Khóa', [assignmentItem()])
    const key = randomUUID()
    const first = await releaseOne(teacher, versionId, {}, key)
    expect(first.statusCode).toBe(201)
    const again = await releaseOne(teacher, versionId, {}, key)
    expect(again.statusCode).toBe(201)
    expect(again.json()).toEqual(first.json())
    const other = await app.inject({
      method: 'POST',
      url: `/api/v1/offerings/${offerings.tin10a1.id}/path-releases`,
      headers: headers(teacher, { 'idempotency-key': key }),
      payload: { title: 'Đợt khác', modules: [{ moduleVersionId: versionId, availableFrom: '2020-01-01T00:00:00.000Z' }] },
    })
    expect(other.statusCode).toBe(409)
    expect(other.json().error.code).toBe('IDEMPOTENCY_KEY_REUSED')
    const paths = await sql<{ n: number }>`SELECT count(*)::int AS n FROM path_releases`.execute(adminDb)
    expect(paths.rows[0]?.n).toBe(1)
  })

  it('P1a-07 GET, GV xem, PH xem và xem trước không ghi tiến độ', async () => {
    const teacher = await session(personas.gvLan.subject, 'teacher')
    const versionId = await publishModule(teacher, 'Xem', [
      assignmentItem(),
      { clientKey: 'p', type: 'page', title: 'Trang', indent: 0, completion: 'view', body: rich('Đọc') },
    ])
    const released = await releaseOne(teacher, versionId, {})
    expect(released.statusCode).toBe(201)
    const releaseId = released.json().moduleReleaseIds[0] as string
    const student = await session(personas.hsMinh.subject, 'student')
    const guardian = await session(personas.phMinh.subject, 'guardian')
    expect((await app.inject({ method: 'GET', url: `/api/v1/module-releases/${releaseId}`, headers: headers(student) })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: `/api/v1/module-releases/${releaseId}`, headers: headers(teacher) })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: `/api/v1/module-releases/${releaseId}`, headers: headers(guardian) })).statusCode).toBe(200)
    const moduleId = (await sql<{ module_id: string }>`SELECT module_id FROM module_versions WHERE id = ${versionId}`.execute(adminDb)).rows[0]?.module_id
    expect((await app.inject({ method: 'GET', url: `/api/v1/modules/${moduleId ?? ''}/draft/preview`, headers: headers(teacher) })).statusCode).toBe(200)
    const progress = await sql<{ n: number }>`SELECT count(*)::int AS n FROM activity_progress`.execute(adminDb)
    expect(progress.rows[0]?.n).toBe(0)
  })

  it('P1a-09 trước giờ mở và HS khác lớp là 404; quá hạn nhận hoặc từ chối muộn là 410', async () => {
    process.env.HCN_NOW = '2026-09-30T02:00:00.000Z'
    const teacher = await session(personas.gvLan.subject, 'teacher')
    const versionId = await publishModule(teacher, 'Lịch', [assignmentItem()])
    const future = await releaseOne(teacher, versionId, { availableFrom: '2026-09-30T03:00:00.000Z' })
    expect(future.statusCode).toBe(201)
    const futureId = future.json().moduleReleaseIds[0] as string
    const minh = await session(personas.hsMinh.subject, 'student')
    const an = await session(personas.hsAn.subject, 'student')
    expect((await app.inject({ method: 'GET', url: `/api/v1/module-releases/${futureId}`, headers: headers(minh) })).statusCode).toBe(404)
    const open = await releaseOne(teacher, versionId, { availableFrom: '2026-09-30T01:00:00.000Z', dueAt: '2026-09-30T04:00:00.000Z' })
    const openId = open.json().moduleReleaseIds[0] as string
    expect((await app.inject({ method: 'GET', url: `/api/v1/module-releases/${openId}`, headers: headers(an) })).statusCode).toBe(404)
    const closed = await releaseOne(teacher, versionId, {
      availableFrom: '2026-09-30T01:00:00.000Z',
      dueAt: '2026-09-30T01:20:00.000Z',
      acceptUntil: '2026-09-30T01:30:00.000Z',
    })
    const closedId = closed.json().moduleReleaseIds[0] as string
    const closedItem = await itemId(versionId, 'assignment')
    expect((await saveDraft(minh, closedId, closedItem, 0, { body: { type: 'text', text: 'muộn' } })).statusCode).toBe(200)
    const afterAccept = await app.inject({
      method: 'POST',
      url: `/api/v1/module-releases/${closedId}/items/${closedItem}/submissions`,
      headers: headers(minh, { 'idempotency-key': randomUUID() }),
      payload: { draftRevision: 1 },
    })
    expect(afterAccept.statusCode).toBe(410)
    expect(afterAccept.json().error.code).toBe('RELEASE_CLOSED')
    const reject = await releaseOne(teacher, versionId, {
      availableFrom: '2026-09-30T01:00:00.000Z',
      dueAt: '2026-09-30T01:30:00.000Z',
      latePolicy: 'reject',
    })
    const rejectId = reject.json().moduleReleaseIds[0] as string
    expect((await saveDraft(minh, rejectId, closedItem, 0, { body: { type: 'text', text: 'muộn' } })).statusCode).toBe(200)
    const afterDue = await app.inject({
      method: 'POST',
      url: `/api/v1/module-releases/${rejectId}/items/${closedItem}/submissions`,
      headers: headers(minh, { 'idempotency-key': randomUUID() }),
      payload: { draftRevision: 1 },
    })
    expect(afterDue.statusCode).toBe(410)
    expect(afterDue.json().error.code).toBe('RELEASE_CLOSED')
  })

  it('AC01 hs.an dùng id của hs.minh thì 404 ở mọi endpoint', async () => {
    const teacher = await session(personas.gvLan.subject, 'teacher')
    const versionId = await publishModule(teacher, 'Riêng', [assignmentItem({ submission: { types: ['text'], allowFiles: true, maxFiles: 1 } })])
    const released = await releaseOne(teacher, versionId, { dueAt: '2099-01-01T00:00:00.000Z' })
    const releaseId = released.json().moduleReleaseIds[0] as string
    const target = await itemId(versionId, 'assignment')
    const minh = await session(personas.hsMinh.subject, 'student')
    const uploaded = await upload(minh, 'bai.txt', Buffer.from('bài của Minh'))
    expect(uploaded.statusCode).toBe(201)
    const fileId = uploaded.json().id as string
    const saved = await saveDraft(minh, releaseId, target, 0, { body: { type: 'text', text: 'của Minh' }, fileIds: [fileId] })
    expect(saved.statusCode).toBe(200)
    await sql`UPDATE files SET scan_status = 'clean', scanned_at = now() WHERE id = ${fileId}`.execute(adminDb)
    const submitted = await app.inject({
      method: 'POST',
      url: `/api/v1/module-releases/${releaseId}/items/${target}/submissions`,
      headers: headers(minh, { 'idempotency-key': randomUUID() }),
      payload: { draftRevision: 1 },
    })
    expect(submitted.statusCode).toBe(201)
    const submissionId = submitted.json().submissionId as string
    const an = await session(personas.hsAn.subject, 'student')
    const urls = [
      `/api/v1/module-releases/${releaseId}`,
      `/api/v1/module-releases/${releaseId}/items/${target}/submission/draft`,
      `/api/v1/submissions/${submissionId}`,
      `/api/v1/files/${fileId}/meta`,
      `/api/v1/files/${fileId}`,
    ]
    for (const url of urls) {
      const response = await app.inject({ method: 'GET', url, headers: headers(an) })
      expect(response.statusCode, url).toBe(404)
    }
    const writes = [
      app.inject({ method: 'PUT', url: `/api/v1/module-releases/${releaseId}/items/${target}/submission/draft`, headers: headers(an, { 'if-match': 'W/"1"' }), payload: { body: { type: 'text', text: 'lấy bài' } } }),
      app.inject({ method: 'POST', url: `/api/v1/module-releases/${releaseId}/items/${target}/view`, headers: headers(an) }),
      app.inject({ method: 'POST', url: `/api/v1/module-releases/${releaseId}/items/${target}/self-mark`, headers: headers(an) }),
      app.inject({ method: 'POST', url: `/api/v1/module-releases/${releaseId}/items/${target}/submissions`, headers: headers(an, { 'idempotency-key': randomUUID() }), payload: { draftRevision: 1 } }),
    ]
    for (const pending of writes) {
      const response = await pending
      expect(response.statusCode).toBe(404)
    }
  })

  it('AC04 phiên mới đọc đúng bản nháp server', async () => {
    const teacher = await session(personas.gvLan.subject, 'teacher')
    const versionId = await publishModule(teacher, 'Nháp', [assignmentItem()])
    const released = await releaseOne(teacher, versionId, {})
    const releaseId = released.json().moduleReleaseIds[0] as string
    const target = await itemId(versionId, 'assignment')
    const first = await session(personas.hsMinh.subject, 'student')
    expect((await saveDraft(first, releaseId, target, 0, { body: { type: 'text', text: 'bản trên server' } })).statusCode).toBe(200)
    const second = await session(personas.hsMinh.subject, 'student')
    const read = await app.inject({ method: 'GET', url: `/api/v1/module-releases/${releaseId}/items/${target}/submission/draft`, headers: headers(second) })
    expect(read.statusCode).toBe(200)
    expect(read.json().body.body.text).toBe('bản trên server')
    expect(read.json().draftRevision).toBe(1)
  })

  it('AC05 hai request nộp đồng thời cùng key chỉ tạo một phiên bản', async () => {
    const teacher = await session(personas.gvLan.subject, 'teacher')
    const versionId = await publishModule(teacher, 'Đua', [assignmentItem()])
    const released = await releaseOne(teacher, versionId, { dueAt: '2099-01-01T00:00:00.000Z' })
    const releaseId = released.json().moduleReleaseIds[0] as string
    const target = await itemId(versionId, 'assignment')
    const student = await session(personas.hsMinh.subject, 'student')
    expect((await saveDraft(student, releaseId, target, 0, { body: { type: 'text', text: 'một lần' } })).statusCode).toBe(200)
    const key = randomUUID()
    const [left, right] = await Promise.all([
      app.inject({ method: 'POST', url: `/api/v1/module-releases/${releaseId}/items/${target}/submissions`, headers: headers(student, { 'idempotency-key': key }), payload: { draftRevision: 1 } }),
      app.inject({ method: 'POST', url: `/api/v1/module-releases/${releaseId}/items/${target}/submissions`, headers: headers(student, { 'idempotency-key': key }), payload: { draftRevision: 1 } }),
    ])
    expect([left.statusCode, right.statusCode].every((status) => status === 201)).toBe(true)
    expect(left.json().submissionVersionId).toBe(right.json().submissionVersionId)
    const versions = await sql<{ n: number }>`SELECT count(*)::int AS n FROM submission_versions`.execute(adminDb)
    expect(versions.rows[0]?.n).toBe(1)
  })

  it('AC06 commit rồi hủy socket, gửi lại cùng key trả cùng receipt', async () => {
    const teacher = await session(personas.gvLan.subject, 'teacher')
    const versionId = await publishModule(teacher, 'Mất phản hồi', [assignmentItem()])
    const released = await releaseOne(teacher, versionId, { dueAt: '2099-01-01T00:00:00.000Z' })
    const releaseId = released.json().moduleReleaseIds[0] as string
    const target = await itemId(versionId, 'assignment')
    const student = await session(personas.hsMinh.subject, 'student')
    expect((await saveDraft(student, releaseId, target, 0, { body: { type: 'text', text: 'đã ghi' } })).statusCode).toBe(200)
    await app.listen({ host: '127.0.0.1', port: 0 })
    const address = app.server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    const key = randomUUID()
    const payload = JSON.stringify({ draftRevision: 1 })
    await new Promise<void>((resolve, reject) => {
      const request = http.request({
        host: '127.0.0.1',
        port,
        path: `/api/v1/module-releases/${releaseId}/items/${target}/submissions`,
        method: 'POST',
        headers: {
          ...headers(student, { 'idempotency-key': key, 'content-type': 'application/json' }),
          'content-length': Buffer.byteLength(payload),
        },
      }, (response) => {
        response.destroy()
        request.destroy()
        resolve()
      })
      request.on('error', () => resolve())
      request.setTimeout(10_000, () => reject(new Error('AC06 timeout')))
      request.end(payload)
    })
    const versions = await sql<{ n: number }>`SELECT count(*)::int AS n FROM submission_versions`.execute(adminDb)
    expect(versions.rows[0]?.n).toBe(1)
    const retry = await app.inject({
      method: 'POST',
      url: `/api/v1/module-releases/${releaseId}/items/${target}/submissions`,
      headers: headers(student, { 'idempotency-key': key }),
      payload: { draftRevision: 1 },
    })
    expect(retry.statusCode).toBe(201)
    const stored = await sql<{ id: string }>`SELECT id FROM submission_versions`.execute(adminDb)
    expect(retry.json().submissionVersionId).toBe(stored.rows[0]?.id)
    const after = await sql<{ n: number }>`SELECT count(*)::int AS n FROM submission_versions`.execute(adminDb)
    expect(after.rows[0]?.n).toBe(1)
  })

  it('A05 nộp draftRevision cũ thì 409 và không tạo phiên bản', async () => {
    const teacher = await session(personas.gvLan.subject, 'teacher')
    const versionId = await publishModule(teacher, 'Revision', [assignmentItem()])
    const released = await releaseOne(teacher, versionId, { dueAt: '2099-01-01T00:00:00.000Z' })
    const releaseId = released.json().moduleReleaseIds[0] as string
    const target = await itemId(versionId, 'assignment')
    const student = await session(personas.hsMinh.subject, 'student')
    expect((await saveDraft(student, releaseId, target, 0, { body: { type: 'text', text: 'r1' } })).statusCode).toBe(200)
    expect((await saveDraft(student, releaseId, target, 1, { body: { type: 'text', text: 'r2' } })).statusCode).toBe(200)
    expect((await saveDraft(student, releaseId, target, 2, { body: { type: 'text', text: 'r3' } })).statusCode).toBe(200)
    expect((await saveDraft(student, releaseId, target, 3, { body: { type: 'text', text: 'r4' } })).statusCode).toBe(200)
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/module-releases/${releaseId}/items/${target}/submissions`,
      headers: headers(student, { 'idempotency-key': randomUUID() }),
      payload: { draftRevision: 3 },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json().error.code).toBe('REVISION_CONFLICT')
    const versions = await sql<{ n: number }>`SELECT count(*)::int AS n FROM submission_versions`.execute(adminDb)
    expect(versions.rows[0]?.n).toBe(0)
  })

  it('AC12 A13 SEC-07 quá 25 MiB thì 413 và loại giả thì 415', async () => {
    const student = await session(personas.hsMinh.subject, 'student')
    const big = await upload(student, 'lon.txt', Buffer.alloc(26_214_401, 0x61))
    expect(big.statusCode).toBe(413)
    expect(big.json().error.code).toBe('FILE_TOO_LARGE')
    const samples: [string, Buffer][] = [
      ['gia.pdf', Buffer.concat([Buffer.from('PK\u0003\u0004'), Buffer.alloc(64, 0)])],
      ['gia.png', Buffer.from('<html><body>không phải ảnh</body></html>')],
      ['ma.exe', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64, 0)])],
      ['ve.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')],
      ['macro.docm', Buffer.concat([Buffer.from('PK\u0003\u0004'), Buffer.alloc(64, 0)])],
    ]
    for (const [name, bytes] of samples) {
      const response = await upload(student, name, bytes)
      expect(response.statusCode, name).toBe(415)
      expect(response.json().error.code).toBe('FILE_TYPE_NOT_ALLOWED')
    }
  })

  it('AC12 A13 SEC-07 EICAR thành infected trong vùng cách ly và tải xuống 404; pending nộp 423; tải sạch có header', async () => {
    const teacher = await session(personas.gvLan.subject, 'teacher')
    const versionId = await publishModule(teacher, 'Tệp', [assignmentItem({ submission: { types: ['text'], allowFiles: true, maxFiles: 2 } })])
    const released = await releaseOne(teacher, versionId, { dueAt: '2099-01-01T00:00:00.000Z' })
    const releaseId = released.json().moduleReleaseIds[0] as string
    const target = await itemId(versionId, 'assignment')
    const student = await session(personas.hsMinh.subject, 'student')
    const clamd = await startFakeClamd()
    try {
      const virus = await upload(student, 'eicar.txt', Buffer.from(eicar))
      expect(virus.statusCode).toBe(201)
      const virusId = virus.json().id as string
      await processOutbox(db, { storageDir, clamdHost: '127.0.0.1', clamdPort: clamd.port, timeoutMs: 5_000 })
      const scanned = await sql<{ scan_status: string; storage_key: string }>`SELECT scan_status, storage_key FROM files WHERE id = ${virusId}`.execute(adminDb)
      expect(scanned.rows[0]?.scan_status).toBe('infected')
      const { access } = await import('node:fs/promises')
      await access(join(storageDir, '.quarantine', scanned.rows[0]?.storage_key ?? ''))
      const hidden = await app.inject({ method: 'GET', url: `/api/v1/files/${virusId}`, headers: headers(student) })
      expect(hidden.statusCode).toBe(404)
      const pending = await upload(student, 'cho.txt', Buffer.from('chưa quét'))
      const pendingId = pending.json().id as string
      expect((await saveDraft(student, releaseId, target, 0, { body: { type: 'text', text: 'kèm tệp' }, fileIds: [pendingId] })).statusCode).toBe(200)
      const early = await app.inject({
        method: 'POST',
        url: `/api/v1/module-releases/${releaseId}/items/${target}/submissions`,
        headers: headers(student, { 'idempotency-key': randomUUID() }),
        payload: { draftRevision: 1 },
      })
      expect(early.statusCode).toBe(423)
      expect(early.json().error.code).toBe('FILE_NOT_SCANNED')
      const clean = await upload(student, 'anh.png', png)
      expect(clean.statusCode).toBe(201)
      const cleanId = clean.json().id as string
      await sql`UPDATE files SET scan_status = 'clean', scanned_at = now() WHERE id = ${cleanId}`.execute(adminDb)
      const download = await app.inject({ method: 'GET', url: `/api/v1/files/${cleanId}`, headers: headers(student) })
      expect(download.statusCode).toBe(200)
      expect(download.headers['x-content-type-options']).toBe('nosniff')
      expect(download.headers['content-security-policy']).toBe('sandbox')
      expect(String(download.headers['content-disposition'])).toContain('attachment')
    } finally {
      await clamd.close()
    }
  })

  it('SEC-09 body nộp hoặc nháp có trường server thì 422', async () => {
    const teacher = await session(personas.gvLan.subject, 'teacher')
    const versionId = await publishModule(teacher, 'Cấm trường', [assignmentItem()])
    const released = await releaseOne(teacher, versionId, {})
    const releaseId = released.json().moduleReleaseIds[0] as string
    const target = await itemId(versionId, 'assignment')
    const student = await session(personas.hsMinh.subject, 'student')
    const draft = await saveDraft(student, releaseId, target, 0, {
      body: { type: 'text', text: 'bài' },
      learnerId: personas.hsAn.subject,
      isLate: false,
      submittedAt: '2020-01-01T00:00:00.000Z',
      score: 10,
    })
    expect(draft.statusCode).toBe(422)
    expect(draft.json().error.code).toBe('VALIDATION_FAILED')
    const submit = await app.inject({
      method: 'POST',
      url: `/api/v1/module-releases/${releaseId}/items/${target}/submissions`,
      headers: headers(student, { 'idempotency-key': randomUUID() }),
      payload: { draftRevision: 1, learnerId: personas.hsAn.subject, isLate: true, submittedAt: '2020-01-01T00:00:00.000Z', score: 10 },
    })
    expect(submit.statusCode).toBe(422)
    expect(submit.json().error.code).toBe('VALIDATION_FAILED')
  })

  it('SEC-16 log không chứa nội dung bài, tên tệp gốc, cookie, token', async () => {
    const teacher = await session(personas.gvLan.subject, 'teacher')
    const versionId = await publishModule(teacher, 'Log', [assignmentItem()])
    const released = await releaseOne(teacher, versionId, { dueAt: '2099-01-01T00:00:00.000Z' })
    const releaseId = released.json().moduleReleaseIds[0] as string
    const target = await itemId(versionId, 'assignment')
    const student = await session(personas.hsMinh.subject, 'student')
    const secret = 'LOI_GIAI_BI_MAT_8841'
    const filename = 'ten-goc-bi-mat.txt'
    logs.length = 0
    const uploaded = await upload(student, filename, Buffer.from('noi dung tep'))
    expect(uploaded.statusCode).toBe(201)
    expect((await saveDraft(student, releaseId, target, 0, { body: { type: 'text', text: secret } })).statusCode).toBe(200)
    const submitted = await app.inject({
      method: 'POST',
      url: `/api/v1/module-releases/${releaseId}/items/${target}/submissions`,
      headers: headers(student, { 'idempotency-key': randomUUID() }),
      payload: { draftRevision: 1 },
    })
    expect(submitted.statusCode).toBe(201)
    const text = logs.join('\n')
    expect(text).not.toContain(secret)
    expect(text).not.toContain(filename)
    expect(text).not.toContain(student.cookie)
    expect(text).not.toContain(student.csrf)
  })

  it('nộp lại tạo v2, v1 và tệp của v1 giữ nguyên', async () => {
    const teacher = await session(personas.gvLan.subject, 'teacher')
    const versionId = await publishModule(teacher, 'Hai lần', [assignmentItem({ submission: { types: ['text'], allowFiles: true, maxFiles: 1 } })])
    const released = await releaseOne(teacher, versionId, { dueAt: '2099-01-01T00:00:00.000Z' })
    const releaseId = released.json().moduleReleaseIds[0] as string
    const target = await itemId(versionId, 'assignment')
    const student = await session(personas.hsMinh.subject, 'student')
    const uploaded = await upload(student, 'v1.txt', Buffer.from('tệp phiên bản một'))
    const fileId = uploaded.json().id as string
    await sql`UPDATE files SET scan_status = 'clean', scanned_at = now() WHERE id = ${fileId}`.execute(adminDb)
    expect((await saveDraft(student, releaseId, target, 0, { body: { type: 'text', text: 'v1' }, fileIds: [fileId] })).statusCode).toBe(200)
    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/module-releases/${releaseId}/items/${target}/submissions`,
      headers: headers(student, { 'idempotency-key': randomUUID() }),
      payload: { draftRevision: 1 },
    })
    expect(first.statusCode).toBe(201)
    expect((await saveDraft(student, releaseId, target, 1, { body: { type: 'text', text: 'v2' } })).statusCode).toBe(200)
    const second = await app.inject({
      method: 'POST',
      url: `/api/v1/module-releases/${releaseId}/items/${target}/submissions`,
      headers: headers(student, { 'idempotency-key': randomUUID() }),
      payload: { draftRevision: 2 },
    })
    expect(second.statusCode).toBe(201)
    expect(second.json().versionNo).toBe(2)
    const rows = await sql<{ version_no: number; body: { body: { text: string } }; file_id: string | null }>`
      SELECT v.version_no, v.body, f.file_id
      FROM submission_versions v
      LEFT JOIN submission_version_files f ON f.submission_version_id = v.id
      ORDER BY v.version_no
    `.execute(adminDb)
    expect(rows.rows[0]?.body.body.text).toBe('v1')
    expect(rows.rows[0]?.file_id).toBe(fileId)
    expect(rows.rows[1]?.body.body.text).toBe('v2')
  })

  it('ảnh chưa sạch thì IMAGE_NOT_CLEAN; ảnh sạch ghi content_files và submission', async () => {
    const teacher = await session(personas.gvLan.subject, 'teacher')
    const uploaded = await upload(teacher, 'so-do.png', png)
    expect(uploaded.statusCode).toBe(201)
    const fileId = uploaded.json().id as string
    const dirty = await publishMaybe(teacher, fileId)
    expect(dirty.statusCode).toBe(422)
    expect(dirty.json().error.details.reason).toBe('IMAGE_NOT_CLEAN')
    await sql`UPDATE files SET scan_status = 'clean', scanned_at = now() WHERE id = ${fileId}`.execute(adminDb)
    const clean = await publishMaybe(teacher, fileId)
    expect(clean.statusCode, clean.body).toBe(201)
    const versionId = clean.json().id as string
    const linked = await sql<{ n: number; alt: string }>`SELECT count(*)::int AS n, min(alt) AS alt FROM content_files WHERE module_version_id = ${versionId}`.execute(adminDb)
    expect(linked.rows[0]?.n).toBe(1)
    expect(linked.rows[0]?.alt).toBe('Sơ đồ')
    const config = await sql<{ submission_config: { types: string[] } | null }>`SELECT submission_config FROM module_items WHERE module_version_id = ${versionId} AND item_type = 'assignment'`.execute(adminDb)
    expect(config.rows[0]?.submission_config?.types).toEqual(['text', 'code'])
  })

  async function publishMaybe(auth: Auth, fileId: string) {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/modules',
      headers: headers(auth),
      payload: { courseId: courses.tin10.id, title: 'Ảnh', requirementIds: [] },
    })
    const moduleId = created.json().moduleId as string
    await app.inject({
      method: 'PUT',
      url: `/api/v1/modules/${moduleId}/draft`,
      headers: headers(auth, { 'if-match': 'W/"1"' }),
      payload: {
        schema: 'module-draft/1',
        title: 'Ảnh',
        requirementIds: [],
        items: [
          { clientKey: 'p', type: 'page', title: 'Trang', indent: 0, completion: 'view', body: { format: 'hcn-rich/1', blocks: [{ type: 'image', fileId, alt: 'Sơ đồ' }] } },
          assignmentItem({ submission: { types: ['text', 'code'], allowFiles: false, maxFiles: 0 } }),
        ],
      },
    })
    return app.inject({
      method: 'POST',
      url: `/api/v1/modules/${moduleId}/versions`,
      headers: headers(auth, { 'idempotency-key': randomUUID() }),
      payload: { expectedRevision: 2, acknowledgements: [] },
    })
  }
})
