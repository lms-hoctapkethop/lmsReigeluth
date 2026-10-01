import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { Writable } from 'node:stream'
import { sql } from 'kysely'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb, type Database } from '@hcn/db'
import type { Kysely } from 'kysely'
import { courses, offerings, personas, schools, seedIdentity } from '@hcn/testkit/identity'
import { startPostgres18, type Postgres18 } from '@hcn/testkit'
import type { FastifyInstance } from 'fastify'
import type { AppConfig } from '../src/config.ts'
import { buildApp } from '../src/server.ts'
import { commitConsumer, processOutbox } from '../../worker/src/loop.ts'
import { runDueSoon } from '../../worker/src/due-soon.ts'

function commandOk(command: string, args: string[]): boolean {
  try {
    execFileSync(command, args, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const ready = commandOk('docker', ['info']) && commandOk('dbmate', ['--version'])
if (process.env.CI === 'true' && !ready) throw new Error('Job CI cần Docker và dbmate để chạy chấm bài')

const appOrigin = 'http://127.0.0.1:4319'
const issuer = 'http://idp.test/realms/hcn'
const workerOptions = { storageDir: '/tmp/hcn-m7', clamdHost: '127.0.0.1', clamdPort: 1 }

type Auth = { cookie: string; csrf: string }
type Role = 'teacher' | 'student' | 'guardian'

function rich(text: string) {
  return { format: 'hcn-rich/1', blocks: [{ type: 'paragraph', children: [{ text }] }] }
}

describe.skipIf(!ready)('chấm bài M7', () => {
  let postgres: Postgres18
  let adminDb: Kysely<Database>
  let db: Kysely<Database>
  let app: FastifyInstance

  beforeAll(async () => {
    postgres = await startPostgres18()
    const cloned = await postgres.cloneDatabase('review_api')
    adminDb = createDb(cloned.url)
    db = createDb(cloned.appUrl)
    const logStream = new Writable({
      write(_chunk, _encoding, callback) {
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
    app = await buildApp({ config, db, logStream })
  }, 300_000)

  beforeEach(async () => {
    await sql`
      TRUNCATE review_criterion_results, attainment_decisions, reviews, notifications, family_supports,
        submission_version_files, submission_versions, submissions, activity_progress, content_files, files,
        release_schedule_changes, module_releases, path_releases, processed_events, outbox_events,
        option_misconceptions, question_kc_links, question_keys, question_items, assessment_versions,
        module_items, rubric_criteria, rubric_versions, module_versions, module_drafts, module_collaborators, modules,
        idempotency_keys, sessions, audit_log
      RESTART IDENTITY CASCADE
    `.execute(adminDb)
    await seedIdentity(adminDb, { issuer })
    await sql`
      UPDATE guardian_links
      SET status = 'verified', revoked_at = NULL, revoked_by = NULL
      WHERE guardian_id = ${personas.phMinh.subject} AND learner_id = ${personas.hsMinh.subject}
    `.execute(adminDb)
  })

  afterAll(async () => {
    await app?.close()
    await db?.destroy()
    await adminDb?.destroy()
    await postgres?.stop()
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

  async function link(): Promise<{ requirementId: string; kcVersionId: string }> {
    const row = await sql<{ requirement_id: string; kc_version_id: string }>`
      SELECT l.requirement_id, l.kc_version_id
      FROM curriculum_requirements r
      JOIN requirement_kc_links l ON l.requirement_id = r.id
      WHERE r.code791_stem = '140110.0601a' AND l.status = 'approved'
      LIMIT 1
    `.execute(adminDb)
    const found = row.rows[0]
    if (!found) throw new Error('thiếu YCCĐ 140110.0601a')
    return { requirementId: found.requirement_id, kcVersionId: found.kc_version_id }
  }

  function assignment(title: string, requirementId: string, kcVersionId: string, clientKey: string) {
    return {
      clientKey,
      type: 'assignment',
      title,
      indent: 0,
      completion: 'submit',
      body: rich('Đề bài'),
      requirementIds: [requirementId],
      rubric: {
        title: 'Rubric',
        criteria: [{ title: 'Rõ ý', kcVersionId, levels: { meets: 'Rõ', developing: 'Tạm', notYet: 'Chưa' } }],
      },
      submission: { types: ['text'] },
    }
  }

  async function publishModule(auth: Auth, title: string, items: Record<string, unknown>[], requirementId: string): Promise<string> {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/modules',
      headers: headers(auth),
      payload: { courseId: courses.tin10.id, title, requirementIds: [requirementId] },
    })
    expect(created.statusCode, created.body).toBe(201)
    const moduleId = created.json().moduleId as string
    const saved = await app.inject({
      method: 'PUT',
      url: `/api/v1/modules/${moduleId}/draft`,
      headers: headers(auth, { 'if-match': 'W/"1"' }),
      payload: { schema: 'module-draft/1', title, requirementIds: [requirementId], items },
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

  async function releaseOne(auth: Auth, versionId: string, dueAt: string) {
    const released = await app.inject({
      method: 'POST',
      url: `/api/v1/offerings/${offerings.tin10a1.id}/path-releases`,
      headers: headers(auth, { 'idempotency-key': randomUUID() }),
      payload: { title: 'Đợt chấm', modules: [{ moduleVersionId: versionId, availableFrom: '2020-01-01T00:00:00.000Z', dueAt }] },
    })
    expect(released.statusCode, released.body).toBe(201)
    return released.json().moduleReleaseIds as string[]
  }

  async function itemIds(versionId: string): Promise<string[]> {
    const row = await sql<{ id: string }>`SELECT id FROM module_items WHERE module_version_id = ${versionId} AND item_type = 'assignment' ORDER BY position`.execute(adminDb)
    return row.rows.map((item) => item.id)
  }

  async function submitText(auth: Auth, releaseId: string, itemId: string, text: string, draftRevision: number): Promise<{ submissionId: string; versionId: string }> {
    const saved = await app.inject({
      method: 'PUT',
      url: `/api/v1/module-releases/${releaseId}/items/${itemId}/submission/draft`,
      headers: headers(auth, { 'if-match': `W/"${String(draftRevision === 1 ? 0 : draftRevision - 1)}"` }),
      payload: { body: { type: 'text', text } },
    })
    expect(saved.statusCode, saved.body).toBe(200)
    const next = saved.json().draftRevision as number
    const submitted = await app.inject({
      method: 'POST',
      url: `/api/v1/module-releases/${releaseId}/items/${itemId}/submissions`,
      headers: headers(auth, { 'idempotency-key': randomUUID() }),
      payload: { draftRevision: next },
    })
    expect(submitted.statusCode, submitted.body).toBe(201)
    const submissionId = submitted.json().submissionId as string
    const version = await sql<{ id: string }>`
      SELECT id FROM submission_versions WHERE submission_id = ${submissionId} ORDER BY version_no DESC LIMIT 1
    `.execute(adminDb)
    const versionId = version.rows[0]?.id
    if (!versionId) throw new Error('thiếu phiên bản')
    return { submissionId, versionId }
  }

  async function grade(auth: Auth, versionId: string, level: 'meets' | 'not_shown' = 'meets') {
    const opened = await app.inject({
      method: 'POST',
      url: `/api/v1/submission-versions/${versionId}/reviews`,
      headers: headers(auth),
    })
    expect(opened.statusCode, opened.body).toBe(200)
    const draft = opened.json() as { id: string; revision: number; criteria: { criterionId: string }[] }
    const saved = await app.inject({
      method: 'PUT',
      url: `/api/v1/reviews/${draft.id}`,
      headers: headers(auth, { 'if-match': `W/"${String(draft.revision)}"` }),
      payload: {
        comment: 'Nháp nhận xét',
        criteria: draft.criteria.map((row) => ({ criterionId: row.criterionId, level, note: null })),
      },
    })
    expect(saved.statusCode, saved.body).toBe(200)
    return saved.json() as { id: string; revision: number; submissionVersionId: string; criteria: { level: string }[]; comment: string }
  }

  async function publish(
    auth: Auth,
    review: { id: string; revision: number; submissionVersionId: string },
    decisions: { requirementId: string; decision: 'achieved' | 'not_yet'; reason: string }[],
  ) {
    return app.inject({
      method: 'POST',
      url: `/api/v1/reviews/${review.id}/publish`,
      headers: headers(auth, { 'idempotency-key': randomUUID() }),
      payload: {
        expectedRevision: review.revision,
        expectedSubmissionVersionId: review.submissionVersionId,
        outcome: 'reviewed',
        decisions,
      },
    })
  }

  it('AC07 A06 nộp v2 khi đang có nháp v1 thì công bố v1 bị chặn và nháp giữ nguyên', async () => {
    const teacher = await session(personas.gvLan.subject, 'teacher')
    const student = await session(personas.hsMinh.subject, 'student')
    const { requirementId, kcVersionId } = await link()
    const versionId = await publishModule(teacher, 'AC07', [assignment('Bài AC07', requirementId, kcVersionId, 'a')], requirementId)
    const releaseId = (await releaseOne(teacher, versionId, '2099-01-01T00:00:00.000Z'))[0] ?? ''
    const itemId = (await itemIds(versionId))[0] ?? ''
    const first = await submitText(student, releaseId, itemId, 'bản một', 1)
    const draft = await grade(teacher, first.versionId)
    const second = await submitText(student, releaseId, itemId, 'bản hai', 2)
    const blocked = await publish(teacher, draft, [])
    expect(blocked.statusCode).toBe(409)
    expect(blocked.json().error.code).toBe('SUBMISSION_VERSION_CHANGED')
    expect(blocked.json().error.details.currentSubmissionVersionId).toBe(second.versionId)
    const again = await app.inject({ method: 'POST', url: `/api/v1/submission-versions/${first.versionId}/reviews`, headers: headers(teacher) })
    expect(again.statusCode).toBe(200)
    expect(again.json()).toMatchObject({ id: draft.id, revision: draft.revision, comment: 'Nháp nhận xét', criteria: [{ level: 'meets' }] })
  })

  it('PUBLISH-RACE hai công bố cùng YCCĐ chỉ để lại một quyết định gốc', async () => {
    const lan = await session(personas.gvLan.subject, 'teacher')
    const hung = await session(personas.gvHung.subject, 'teacher')
    await sql`
      INSERT INTO teacher_assignments (id, school_id, offering_id, teacher_id, capabilities, valid)
      VALUES (
        '44000000-0000-4000-8000-0000000000f7',
        ${schools.an.id}, ${offerings.tin10a1.id}, ${personas.gvHung.subject},
        ARRAY['review']::text[], tstzrange('2026-09-01T00:00:00Z', NULL, '[)')
      )
      ON CONFLICT (id) DO NOTHING
    `.execute(adminDb)
    const student = await session(personas.hsMinh.subject, 'student')
    const { requirementId, kcVersionId } = await link()
    const versionId = await publishModule(
      lan,
      'Race',
      [assignment('Bài A', requirementId, kcVersionId, 'a'), assignment('Bài B', requirementId, kcVersionId, 'b')],
      requirementId,
    )
    const releaseId = (await releaseOne(lan, versionId, '2099-01-01T00:00:00.000Z'))[0] ?? ''
    const [firstItem, secondItem] = await itemIds(versionId)
    if (!firstItem || !secondItem) throw new Error('thiếu hai mục')
    const first = await submitText(student, releaseId, firstItem, 'một', 1)
    const second = await submitText(student, releaseId, secondItem, 'hai', 1)
    const left = await grade(lan, first.versionId)
    const right = await grade(hung, second.versionId)
    const decision = { requirementId, decision: 'achieved' as const, reason: 'Đạt yêu cầu' }
    const [one, two] = await Promise.all([publish(lan, left, [decision]), publish(hung, right, [decision])])
    const statuses = [one.statusCode, two.statusCode].sort()
    expect(statuses).toEqual([200, 409])
    const failed = one.statusCode === 409 ? one : two
    expect(failed.json().error.code).toBe('REVISION_CONFLICT')
    expect(failed.json().error.details.reason).toBe('DECISION_CHANGED')
    const roots = await sql<{ n: string }>`SELECT count(*)::text AS n FROM attainment_decisions WHERE supersedes_id IS NULL`.execute(adminDb)
    const current = await sql<{ n: string }>`SELECT count(*)::text AS n FROM attainment_current`.execute(adminDb)
    expect(roots.rows[0]?.n).toBe('1')
    expect(current.rows[0]?.n).toBe('1')
  })

  it('AC10 thay quyết định hiện hành và từ chối quyết định cũ', async () => {
    const teacher = await session(personas.gvLan.subject, 'teacher')
    const student = await session(personas.hsMinh.subject, 'student')
    const { requirementId, kcVersionId } = await link()
    const versionId = await publishModule(teacher, 'AC10', [assignment('Bài AC10', requirementId, kcVersionId, 'a')], requirementId)
    const releaseId = (await releaseOne(teacher, versionId, '2099-01-01T00:00:00.000Z'))[0] ?? ''
    const itemId = (await itemIds(versionId))[0] ?? ''
    const submitted = await submitText(student, releaseId, itemId, 'bài', 1)
    const draft = await grade(teacher, submitted.versionId)
    const published = await publish(teacher, draft, [{ requirementId, decision: 'achieved', reason: 'Đạt lần đầu' }])
    expect(published.statusCode, published.body).toBe(200)
    const decisionId = published.json().decisions[0].id as string
    const replaced = await app.inject({
      method: 'POST',
      url: `/api/v1/attainment-decisions/${decisionId}/supersede`,
      headers: headers(teacher, { 'idempotency-key': randomUUID() }),
      payload: { decision: 'not_yet', reason: 'Cần làm lại bài', reviewId: draft.id },
    })
    expect(replaced.statusCode, replaced.body).toBe(201)
    const rows = await sql<{ id: string; superseded: boolean }>`
      SELECT d.id, (c.id IS NOT NULL) AS superseded
      FROM attainment_decisions d
      LEFT JOIN attainment_current c ON c.id = d.id
      ORDER BY d.decided_at
    `.execute(adminDb)
    expect(rows.rows).toHaveLength(2)
    expect(rows.rows[1]?.id).toBe(replaced.json().id)
    expect(rows.rows[1]?.superseded).toBe(true)
    expect(rows.rows[0]?.superseded).toBe(false)
    const stale = await app.inject({
      method: 'POST',
      url: `/api/v1/attainment-decisions/${decisionId}/supersede`,
      headers: headers(teacher, { 'idempotency-key': randomUUID() }),
      payload: { decision: 'achieved', reason: 'Quay lại quyết định cũ', reviewId: draft.id },
    })
    expect(stale.statusCode).toBe(409)
    expect(stale.json().error.details.reason).toBe('DECISION_CHANGED')
  })

  it('C06 công bố không chọn quyết định thì không có attainment_decisions', async () => {
    const teacher = await session(personas.gvLan.subject, 'teacher')
    const student = await session(personas.hsMinh.subject, 'student')
    const { requirementId, kcVersionId } = await link()
    const versionId = await publishModule(teacher, 'C06', [assignment('Bài C06', requirementId, kcVersionId, 'a')], requirementId)
    const releaseId = (await releaseOne(teacher, versionId, '2099-01-01T00:00:00.000Z'))[0] ?? ''
    const itemId = (await itemIds(versionId))[0] ?? ''
    const submitted = await submitText(student, releaseId, itemId, 'bài', 1)
    const draft = await grade(teacher, submitted.versionId, 'not_shown')
    const published = await publish(teacher, draft, [])
    expect(published.statusCode, published.body).toBe(200)
    expect(published.json().decisions).toEqual([])
    const count = await sql<{ n: string }>`SELECT count(*)::text AS n FROM attainment_decisions`.execute(adminDb)
    expect(count.rows[0]?.n).toBe('0')
  })

  it('A02 B09 phụ huynh chỉ xem đúng con và mất quyền ngay khi thu hồi', async () => {
    const guardian = await session(personas.phMinh.subject, 'guardian')
    const allowed = await app.inject({ method: 'GET', url: `/api/v1/children/${personas.hsMinh.subject}/overview`, headers: headers(guardian) })
    expect(allowed.statusCode, allowed.body).toBe(200)
    const body = JSON.stringify(allowed.json())
    expect(body).not.toContain('needs')
    expect(body).not.toContain('draft')
    expect(body).not.toContain('reflection')
    const denied = await app.inject({ method: 'GET', url: `/api/v1/children/${personas.hsAn.subject}/overview`, headers: headers(guardian) })
    expect(denied.statusCode).toBe(404)
    await sql`
      UPDATE guardian_links
      SET status = 'revoked', revoked_at = now()
      WHERE guardian_id = ${personas.phMinh.subject} AND learner_id = ${personas.hsMinh.subject}
    `.execute(adminDb)
    const after = await app.inject({ method: 'GET', url: `/api/v1/children/${personas.hsMinh.subject}/overview`, headers: headers(guardian) })
    expect(after.statusCode).toBe(404)
  })

  it('AC11 A08 chạy lại consumer sau khi đã commit không tạo thêm thông báo', async () => {
    const teacher = await session(personas.gvLan.subject, 'teacher')
    const student = await session(personas.hsMinh.subject, 'student')
    const { requirementId, kcVersionId } = await link()
    const versionId = await publishModule(teacher, 'AC11', [assignment('Bài AC11', requirementId, kcVersionId, 'a')], requirementId)
    const releaseId = (await releaseOne(teacher, versionId, '2099-01-01T00:00:00.000Z'))[0] ?? ''
    const itemId = (await itemIds(versionId))[0] ?? ''
    const submitted = await submitText(student, releaseId, itemId, 'bài', 1)
    const draft = await grade(teacher, submitted.versionId)
    const published = await publish(teacher, draft, [])
    expect(published.statusCode, published.body).toBe(200)
    const event = await sql<{ id: string; event_id: string; event_type: string; payload: Record<string, string>; attempts: number; school_id: string }>`
      SELECT id::text, event_id::text, event_type, payload, attempts, school_id::text
      FROM outbox_events
      WHERE event_type = 'ReviewPublished' AND status = 'pending'
    `.execute(adminDb)
    const row = event.rows[0]
    if (!row) throw new Error('thiếu ReviewPublished')
    await commitConsumer(db, row, workerOptions)
    const mid = await sql<{ n: string }>`SELECT count(*)::text AS n FROM notifications WHERE kind = 'review_published'`.execute(adminDb)
    expect(Number(mid.rows[0]?.n)).toBeGreaterThan(0)
    const still = await sql<{ status: string }>`SELECT status FROM outbox_events WHERE id = ${row.id}::bigint`.execute(adminDb)
    expect(still.rows[0]?.status).toBe('pending')
    await processOutbox(db, workerOptions)
    const after = await sql<{ n: string }>`SELECT count(*)::text AS n FROM notifications WHERE kind = 'review_published'`.execute(adminDb)
    expect(after.rows[0]?.n).toBe(mid.rows[0]?.n)
    const payload = await sql<{ payload: { title?: string; href?: string; comment?: string } }>`
      SELECT payload FROM notifications WHERE kind = 'review_published' LIMIT 1
    `.execute(adminDb)
    expect(Object.keys(payload.rows[0]?.payload ?? {}).sort()).toEqual(['href', 'title'])
  })

  it('DUE-SOON mỗi học sinh một thông báo trong cùng giờ và học sinh đã nộp không nhận', async () => {
    const teacher = await session(personas.gvLan.subject, 'teacher')
    const an = await session(personas.hsAn.subject, 'student')
    await sql`
      INSERT INTO offering_enrollments (school_id, offering_id, learner_id, status)
      VALUES (${schools.an.id}, ${offerings.tin10a1.id}, ${personas.hsAn.subject}, 'active')
      ON CONFLICT (offering_id, learner_id) DO NOTHING
    `.execute(adminDb)
    const { requirementId, kcVersionId } = await link()
    const versionId = await publishModule(teacher, 'Hạn', [assignment('Bài hạn', requirementId, kcVersionId, 'a')], requirementId)
    const due = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString()
    const releaseId = (await releaseOne(teacher, versionId, due))[0] ?? ''
    const itemId = (await itemIds(versionId))[0] ?? ''
    await submitText(an, releaseId, itemId, 'đã nộp', 1)
    const first = await runDueSoon(db, new Date())
    const second = await runDueSoon(db, new Date())
    expect(first).toBe(1)
    expect(second).toBe(0)
    const rows = await sql<{ recipient_id: string }>`SELECT recipient_id FROM notifications WHERE kind = 'due_soon'`.execute(adminDb)
    expect(rows.rows.map((row) => row.recipient_id)).toEqual([personas.hsMinh.subject])
  })

  it('FAMILY đồng hành không đổi tiến độ hay quyết định và hủy lần hai thì 422', async () => {
    const guardian = await session(personas.phMinh.subject, 'guardian')
    const beforeProgress = await sql<{ n: string }>`SELECT count(*)::text AS n FROM activity_progress`.execute(adminDb)
    const beforeDecision = await sql<{ n: string }>`SELECT count(*)::text AS n FROM attainment_decisions`.execute(adminDb)
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/family-supports',
      headers: headers(guardian, { 'idempotency-key': randomUUID() }),
      payload: { learnerId: personas.hsMinh.subject, offeringId: offerings.tin10a1.id, content: 'Nhắc con luyện tối nay' },
    })
    expect(created.statusCode, created.body).toBe(201)
    const cancelled = await app.inject({
      method: 'POST',
      url: `/api/v1/family-supports/${created.json().id as string}/cancel`,
      headers: headers(guardian),
    })
    expect(cancelled.statusCode, cancelled.body).toBe(200)
    const afterProgress = await sql<{ n: string }>`SELECT count(*)::text AS n FROM activity_progress`.execute(adminDb)
    const afterDecision = await sql<{ n: string }>`SELECT count(*)::text AS n FROM attainment_decisions`.execute(adminDb)
    expect(afterProgress.rows[0]?.n).toBe(beforeProgress.rows[0]?.n)
    expect(afterDecision.rows[0]?.n).toBe(beforeDecision.rows[0]?.n)
    const again = await app.inject({
      method: 'POST',
      url: `/api/v1/family-supports/${created.json().id as string}/cancel`,
      headers: headers(guardian),
    })
    expect(again.statusCode).toBe(422)
  })
})
