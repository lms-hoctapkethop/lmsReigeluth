import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from 'kysely'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
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
if (process.env.HCN_RESILIENCE === '1' && !ready) throw new Error('Job resilience cần Docker và dbmate')

const appOrigin = 'http://127.0.0.1:4319'
const issuer = 'http://127.0.0.1:9/realms/hcn'

function rich(text: string) {
  return { format: 'hcn-rich/1', blocks: [{ type: 'paragraph', children: [{ text }] }] }
}

describe('REL-02 và REL-04', () => {
  it('process.exit chỉ khi HCN_ENV=test và đúng lệnh', () => {
    const script = fileURLToPath(new URL('../../../tests/resilience/rel-02.mjs', import.meta.url))
    const die = spawnSync(process.execPath, ['--experimental-strip-types', script, 'submitAssignment'], {
      env: { PATH: process.env.PATH ?? '', HCN_ENV: 'test', HCN_FAULT_AFTER_COMMIT: 'submitAssignment' },
      encoding: 'utf8',
    })
    expect(die.status).toBe(1)
    expect(die.stdout).not.toContain('alive')
    const staging = spawnSync(process.execPath, ['--experimental-strip-types', script, 'submitAssignment'], {
      env: { PATH: process.env.PATH ?? '', HCN_ENV: 'staging', HCN_FAULT_AFTER_COMMIT: 'submitAssignment' },
      encoding: 'utf8',
    })
    expect(staging.status).toBe(0)
    expect(staging.stdout).toContain('alive')
  })

  it('đăng nhập báo lỗi thân thiện khi nhà phát hành không tới được', async () => {
    const config: AppConfig = {
      appOrigin,
      databaseUrl: 'postgres://hcn:hcn@127.0.0.1:5432/hcn',
      oidcIssuer: issuer,
      oidcClientId: 'hcn-web',
      oidcClientSecret: 'test-secret',
      cookieSecret: 'test-cookie-secret-with-32-characters',
      sessionTtlHours: 12,
      sessionMaxDays: 7,
      trustProxy: [],
      port: 4319,
      hcnEnv: 'test',
      metricsPort: 9464,
      backupMetricsFile: '/run/hcn-metrics/backup.prom',
      faultAfterCommit: null,
    }
    const app = await buildApp({ config, db: {} as Kysely<Database> })
    const response = await app.inject({ method: 'GET', url: '/auth/login' })
    expect(response.statusCode).toBe(503)
    expect(response.headers['content-type']).toContain('text/html')
    expect(response.body).toContain('không dùng được')
    await app.close()
  })
})

describe.skipIf(process.env.HCN_RESILIENCE !== '1' || !ready)('REL-01 REL-03 REL-04 phiên', () => {
  let postgres: Postgres18
  let adminDb: Kysely<Database>
  let db: Kysely<Database>
  let app: FastifyInstance
  let storageDir: string
  const stopSeconds = Number(process.env.HCN_REL01_SECONDS ?? '600')

  const config: AppConfig = {
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
    hcnEnv: 'test',
    metricsPort: 9464,
    backupMetricsFile: '/run/hcn-metrics/backup.prom',
    faultAfterCommit: null,
  }

  beforeAll(async () => {
    postgres = await startPostgres18()
    const cloned = await postgres.cloneDatabase('resilience')
    adminDb = createDb(cloned.url)
    db = createDb(cloned.appUrl)
    config.databaseUrl = cloned.url
    storageDir = await mkdtemp(join(tmpdir(), 'hcn-rel-'))
    app = await buildApp({ config, db, storageDir })
  }, 300_000)

  beforeEach(async () => {
    await sql`
      TRUNCATE submission_version_files, submission_versions, submissions, activity_progress, content_files, files,
        release_schedule_changes, module_releases, path_releases, processed_events, outbox_events, notifications,
        option_misconceptions, question_kc_links, question_keys, question_items, assessment_versions,
        module_items, rubric_criteria, rubric_versions, module_versions, module_drafts, module_collaborators, modules,
        idempotency_keys, sessions, audit_log
      RESTART IDENTITY CASCADE
    `.execute(adminDb)
    await seedIdentity(adminDb, { issuer })
  })

  afterAll(async () => {
    await app?.close()
    await db?.destroy()
    await adminDb?.destroy()
    await postgres?.stop()
    if (storageDir) await rm(storageDir, { recursive: true, force: true })
  })

  async function session(userId: string, role: 'teacher' | 'student'): Promise<{ cookie: string; csrf: string }> {
    const token = randomUUID()
    const hash = createHash('sha256').update(token).digest('hex')
    const csrf = randomUUID()
    await sql`
      INSERT INTO sessions (id_hash, user_id, csrf_token, context, created_at, last_seen_at, expires_at)
      VALUES (${hash}, ${userId}, ${csrf}, ${JSON.stringify({ school_id: schools.an.id, role })}::jsonb, now(), now(), now() + interval '2 hours')
    `.execute(db)
    return { cookie: `hcn_sid=${token}`, csrf }
  }

  function headers(auth: { cookie: string; csrf: string }, extra: Record<string, string> = {}) {
    return { cookie: auth.cookie, origin: appOrigin, 'x-csrf-token': auth.csrf, ...extra }
  }

  it('dừng worker không mất bài và không nhân thông báo', async () => {
    const teacher = await session(personas.gvLan.subject, 'teacher')
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/modules',
      headers: headers(teacher),
      payload: { courseId: courses.tin10.id, title: 'REL-01', requirementIds: [] },
    })
    expect(created.statusCode).toBe(201)
    const moduleId = created.json().moduleId as string
    const saved = await app.inject({
      method: 'PUT',
      url: `/api/v1/modules/${moduleId}/draft`,
      headers: headers(teacher, { 'if-match': 'W/"1"' }),
      payload: {
        schema: 'module-draft/1',
        title: 'REL-01',
        requirementIds: [],
        items: [{ clientKey: 'a', type: 'assignment', title: 'Nhiệm vụ', indent: 0, completion: 'submit', body: rich('Đề'), requirementIds: [] }],
      },
    })
    expect(saved.statusCode).toBe(200)
    const published = await app.inject({
      method: 'POST',
      url: `/api/v1/modules/${moduleId}/versions`,
      headers: headers(teacher, { 'idempotency-key': randomUUID() }),
      payload: { expectedRevision: 2, acknowledgements: [] },
    })
    expect(published.statusCode).toBe(201)
    const released = await app.inject({
      method: 'POST',
      url: `/api/v1/offerings/${offerings.tin10a1.id}/path-releases`,
      headers: headers(teacher, { 'idempotency-key': randomUUID() }),
      payload: { title: 'Đợt', modules: [{ moduleVersionId: published.json().id, availableFrom: '2020-01-01T00:00:00.000Z' }] },
    })
    expect(released.statusCode).toBe(201)
    const releaseId = released.json().moduleReleaseIds[0] as string
    const item = await sql<{ id: string }>`SELECT id FROM module_items WHERE module_version_id = ${published.json().id as string} AND item_type = 'assignment'`.execute(adminDb)
    const itemId = item.rows[0]?.id
    expect(itemId).toBeTruthy()
    const student = await session(personas.hsMinh.subject, 'student')
    const draft = await app.inject({
      method: 'PUT',
      url: `/api/v1/module-releases/${releaseId}/items/${itemId ?? ''}/submission/draft`,
      headers: headers(student, { 'if-match': 'W/"0"' }),
      payload: { body: { type: 'text', text: 'bài còn' } },
    })
    expect(draft.statusCode).toBe(200)
    const submitted = await app.inject({
      method: 'POST',
      url: `/api/v1/module-releases/${releaseId}/items/${itemId ?? ''}/submissions`,
      headers: headers(student, { 'idempotency-key': randomUUID() }),
      payload: { draftRevision: 1 },
    })
    expect(submitted.statusCode).toBe(201)
    const before = await sql<{ n: number }>`SELECT count(*)::int AS n FROM submission_versions`.execute(adminDb)
    expect(before.rows[0]?.n).toBe(1)
    await new Promise((resolve) => setTimeout(resolve, stopSeconds * 1000))
    const during = await sql<{ n: number }>`SELECT count(*)::int AS n FROM submission_versions`.execute(adminDb)
    expect(during.rows[0]?.n).toBe(1)
    const worker = { storageDir, clamdHost: '127.0.0.1', clamdPort: 1, timeoutMs: 200 }
    for (let turn = 0; turn < 20; turn += 1) {
      const drained = await processOutbox(adminDb, worker)
      if (drained === 0) break
    }
    const notices = await sql<{ n: number }>`SELECT count(*)::int AS n FROM notifications`.execute(adminDb)
    await processOutbox(adminDb, worker)
    const again = await sql<{ n: number }>`SELECT count(*)::int AS n FROM notifications`.execute(adminDb)
    expect(again.rows[0]?.n).toBe(notices.rows[0]?.n)
    const still = await sql<{ n: number }>`SELECT count(*)::int AS n FROM submission_versions`.execute(adminDb)
    expect(still.rows[0]?.n).toBe(1)
  }, 900_000)

  it('dừng clamav thì tệp còn pending và nộp trả 423', async () => {
    const teacher = await session(personas.gvLan.subject, 'teacher')
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/modules',
      headers: headers(teacher),
      payload: { courseId: courses.tin10.id, title: 'REL-03', requirementIds: [] },
    })
    const moduleId = created.json().moduleId as string
    await app.inject({
      method: 'PUT',
      url: `/api/v1/modules/${moduleId}/draft`,
      headers: headers(teacher, { 'if-match': 'W/"1"' }),
      payload: {
        schema: 'module-draft/1',
        title: 'REL-03',
        requirementIds: [],
        items: [{
          clientKey: 'a',
          type: 'assignment',
          title: 'Tệp',
          indent: 0,
          completion: 'submit',
          body: rich('Đề'),
          requirementIds: [],
          submission: { types: ['text'], allowFiles: true, maxFiles: 1 },
        }],
      },
    })
    const published = await app.inject({
      method: 'POST',
      url: `/api/v1/modules/${moduleId}/versions`,
      headers: headers(teacher, { 'idempotency-key': randomUUID() }),
      payload: { expectedRevision: 2, acknowledgements: [] },
    })
    const released = await app.inject({
      method: 'POST',
      url: `/api/v1/offerings/${offerings.tin10a1.id}/path-releases`,
      headers: headers(teacher, { 'idempotency-key': randomUUID() }),
      payload: { title: 'Đợt', modules: [{ moduleVersionId: published.json().id, availableFrom: '2020-01-01T00:00:00.000Z', dueAt: '2099-01-01T00:00:00.000Z' }] },
    })
    const releaseId = released.json().moduleReleaseIds[0] as string
    const item = await sql<{ id: string }>`SELECT id FROM module_items WHERE module_version_id = ${published.json().id as string}`.execute(adminDb)
    const itemId = item.rows[0]?.id ?? ''
    const student = await session(personas.hsMinh.subject, 'student')
    const clamd = await startFakeClamd()
    await clamd.close()
    const boundary = '----hcnboundary'
    const bytes = Buffer.from('chua quet')
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.txt"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ])
    const uploaded = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      headers: headers(student, { 'content-type': `multipart/form-data; boundary=${boundary}` }),
      payload,
    })
    expect(uploaded.statusCode).toBe(201)
    const fileId = uploaded.json().id as string
    await processOutbox(db, { storageDir, clamdHost: '127.0.0.1', clamdPort: clamd.port, timeoutMs: 200 })
    const scanned = await sql<{ scan_status: string }>`SELECT scan_status FROM files WHERE id = ${fileId}`.execute(adminDb)
    expect(scanned.rows[0]?.scan_status).toBe('pending')
    const draft = await app.inject({
      method: 'PUT',
      url: `/api/v1/module-releases/${releaseId}/items/${itemId}/submission/draft`,
      headers: headers(student, { 'if-match': 'W/"0"' }),
      payload: { body: { type: 'text', text: 'kèm tệp' }, fileIds: [fileId] },
    })
    expect(draft.statusCode).toBe(200)
    const submitted = await app.inject({
      method: 'POST',
      url: `/api/v1/module-releases/${releaseId}/items/${itemId}/submissions`,
      headers: headers(student, { 'idempotency-key': randomUUID() }),
      payload: { draftRevision: 1 },
    })
    expect(submitted.statusCode).toBe(423)
    expect(submitted.json().error.code).toBe('FILE_NOT_SCANNED')
  }, 180_000)

  it('phiên cũ vẫn gọi API khi nhà phát hành đã tắt', async () => {
    const student = await session(personas.hsMinh.subject, 'student')
    const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: headers(student) })
    expect(me.statusCode).toBe(200)
    const login = await app.inject({ method: 'GET', url: '/auth/login' })
    expect(login.statusCode).toBe(503)
    expect(login.body).toContain('không dùng được')
  })
})
