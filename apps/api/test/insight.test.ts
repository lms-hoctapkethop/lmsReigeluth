import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { sql, type Kysely } from 'kysely'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb, type Database } from '@hcn/db'
import { featureAiEnabled } from '@hcn/domain'
import { courses, offerings, personas, schools, seedIdentity } from '@hcn/testkit/identity'
import { startPostgres18, type Postgres18 } from '@hcn/testkit'
import type { FastifyInstance } from 'fastify'
import { backfillInsights } from '../../worker/src/insight/backfill.ts'
import { processOutbox } from '../../worker/src/loop.ts'
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
if (process.env.CI === 'true' && !ready) throw new Error('Job CI cần Docker và dbmate để chạy insight')

const issuer = 'http://idp.test/realms/hcn'
const appOrigin = 'http://127.0.0.1:4319'
const workerOptions = { storageDir: '/tmp/hcn-m8', clamdHost: '127.0.0.1', clamdPort: 1 }
type Auth = { cookie: string; csrf: string }

function workerUrl(adminUrl: string): string {
  const url = new URL(adminUrl)
  url.username = 'hcn_test_worker'
  url.password = 'hcn_test_worker'
  return url.toString()
}

function rich(text: string) {
  return { format: 'hcn-rich/1', blocks: [{ type: 'paragraph', children: [{ text }] }] }
}

describe.skipIf(!ready)('insight M8', () => {
  let postgres: Postgres18
  let adminDb: Kysely<Database>
  let appDb: Kysely<Database>
  let workerDb: Kysely<Database>
  let app: FastifyInstance
  let databaseUrl = ''

  beforeAll(async () => {
    postgres = await startPostgres18()
    const cloned = await postgres.cloneDatabase('insight_m8')
    databaseUrl = cloned.url
    adminDb = createDb(cloned.url)
    appDb = createDb(cloned.appUrl)
    await sql`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hcn_test_worker') THEN
          CREATE ROLE hcn_test_worker LOGIN PASSWORD 'hcn_test_worker' IN ROLE hcn_worker;
        END IF;
      END $$;
    `.execute(adminDb)
    workerDb = createDb(workerUrl(cloned.url))
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
    app = await buildApp({ config, db: appDb })
  }, 300_000)

  beforeEach(async () => {
    await sql`
      TRUNCATE misconception_signals, needs_estimates, observations,
        attempt_hint_usage, question_responses, quiz_attempts, attainment_decisions,
        review_criterion_results, reviews, submission_version_files, submission_versions, submissions,
        activity_progress, content_files, files, release_schedule_changes, module_releases, path_releases,
        processed_events, outbox_events, option_misconceptions, question_kc_links, question_keys, question_items,
        assessment_versions, module_items, rubric_criteria, rubric_versions, module_versions, module_drafts,
        module_collaborators, modules, idempotency_keys, sessions, audit_log
      RESTART IDENTITY CASCADE
    `.execute(adminDb)
    await seedIdentity(adminDb, { issuer })
  })

  afterAll(async () => {
    await app?.close()
    await workerDb?.destroy()
    await appDb?.destroy()
    await adminDb?.destroy()
    await postgres?.stop()
  })

  async function session(userId: string, role: 'teacher' | 'student' | 'guardian'): Promise<Auth> {
    const token = randomUUID()
    const hash = createHash('sha256').update(token).digest('hex')
    const csrf = randomUUID()
    await sql`
      INSERT INTO sessions (id_hash, user_id, csrf_token, context, created_at, last_seen_at, expires_at)
      VALUES (${hash}, ${userId}, ${csrf}, ${JSON.stringify({ school_id: schools.an.id, role })}::jsonb, now(), now(), now() + interval '2 hours')
    `.execute(adminDb)
    return { cookie: `hcn_sid=${token}`, csrf }
  }

  function headers(auth: Auth, extra: Record<string, string> = {}): Record<string, string> {
    return { cookie: auth.cookie, origin: appOrigin, 'x-csrf-token': auth.csrf, ...extra }
  }

  async function requirementId(): Promise<string> {
    const row = await adminDb.selectFrom('curriculum_requirements').select('id').where('code791_stem', '=', '140110.0601a').executeTakeFirstOrThrow()
    return row.id
  }

  async function approvedKc(code: string): Promise<string> {
    const row = await adminDb
      .selectFrom('kc_versions')
      .innerJoin('knowledge_components', 'knowledge_components.id', 'kc_versions.kc_id')
      .select('kc_versions.id')
      .where('knowledge_components.code', '=', code)
      .where('kc_versions.status', '=', 'approved')
      .executeTakeFirstOrThrow()
    return row.id
  }

  async function drain(): Promise<void> {
    for (let turn = 0; turn < 6; turn += 1) {
      const count = await processOutbox(workerDb, workerOptions)
      if (count === 0) return
    }
  }

  async function publishQuiz(questions: Record<string, unknown>[], purpose = 'practice') {
    const teacher = await session(personas.gvLan.subject, 'teacher')
    const requirement = await requirementId()
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/modules',
      headers: headers(teacher),
      payload: { courseId: courses.tin10.id, title: 'Quiz M8', requirementIds: [requirement] },
    })
    expect(created.statusCode, created.body).toBe(201)
    const moduleId = created.json().moduleId as string
    const saved = await app.inject({
      method: 'PUT',
      url: `/api/v1/modules/${moduleId}/draft`,
      headers: headers(teacher, { 'if-match': 'W/"1"' }),
      payload: {
        schema: 'module-draft/1',
        title: 'Quiz M8',
        requirementIds: [requirement],
        items: [{
          clientKey: 'q',
          type: 'quiz',
          title: 'Quiz M8',
          indent: 0,
          completion: 'submit',
          assessment: {
            purpose,
            showFeedback: 'immediate',
            hintsEnabled: purpose === 'practice',
            maxAttempts: purpose === 'practice' ? null : 1,
            shuffleOptions: false,
            questions,
          },
        }],
      },
    })
    expect(saved.statusCode, saved.body).toBe(200)
    const published = await app.inject({
      method: 'POST',
      url: `/api/v1/modules/${moduleId}/versions`,
      headers: headers(teacher, { 'idempotency-key': randomUUID() }),
      payload: { expectedRevision: 2, acknowledgements: [{ code: 'V02', target: requirement, reason: 'Quiz chưa có sản phẩm.' }] },
    })
    expect(published.statusCode, published.body).toBe(201)
    const versionId = published.json().id as string
    const released = await app.inject({
      method: 'POST',
      url: `/api/v1/offerings/${offerings.tin10a1.id}/path-releases`,
      headers: headers(teacher, { 'idempotency-key': randomUUID() }),
      payload: { title: 'Đợt M8', modules: [{ moduleVersionId: versionId, availableFrom: '2020-01-01T00:00:00.000Z' }] },
    })
    expect(released.statusCode, released.body).toBe(201)
    const releaseId = released.json().moduleReleaseIds[0] as string
    const item = await sql<{ id: string }>`SELECT id FROM module_items WHERE module_version_id = ${versionId} AND item_type = 'quiz'`.execute(adminDb)
    const itemId = item.rows[0]?.id ?? ''
    const ids = await sql<{ id: string }>`
      SELECT qi.id FROM question_items qi
      JOIN assessment_versions av ON av.id = qi.assessment_version_id
      WHERE av.module_item_id = ${itemId}
      ORDER BY qi.position
    `.execute(adminDb)
    return { releaseId, itemId, questionIds: ids.rows.map((row) => row.id) }
  }

  it('PARTIAL-01 multi_choice partial ghi points lẻ và quan sát đúng điểm', async () => {
    const kc = await approvedKc('KC-TIN10-CAULENH')
    const quiz = await publishQuiz([{
      clientKey: 'p',
      qtype: 'multi_choice',
      stem: rich('Chọn'),
      options: [{ id: 'a', label: 'A' }, { id: 'c', label: 'C' }, { id: 'b', label: 'B' }],
      answerKey: { options: ['a', 'c'], scoring: 'partial' },
      kcRequired: [],
      kcObservable: [kc],
      bloomTarget: 2,
      hints: ['Gợi ý'],
    }])
    const student = await session(personas.hsMinh.subject, 'student')
    const started = await app.inject({
      method: 'POST',
      url: `/api/v1/module-releases/${quiz.releaseId}/items/${quiz.itemId}/attempts`,
      headers: headers(student, { 'idempotency-key': randomUUID(), 'content-type': 'application/json' }),
      payload: {},
    })
    expect(started.statusCode, started.body).toBe(201)
    const attemptId = started.json().id as string
    const answered = await app.inject({
      method: 'POST',
      url: `/api/v1/attempts/${attemptId}/questions/${quiz.questionIds[0] ?? ''}/answers`,
      headers: headers(student, { 'idempotency-key': randomUUID(), 'content-type': 'application/json' }),
      payload: { response: { options: ['a'] } },
    })
    expect(answered.statusCode, answered.body).toBe(200)
    const stored = await sql<{ points: string; correct: boolean }>`
      SELECT points::text, correct FROM question_responses WHERE attempt_id = ${attemptId}
    `.execute(adminDb)
    expect(stored.rows[0]?.correct).toBe(false)
    expect(Number(stored.rows[0]?.points)).toBe(0.5)
    await drain()
    const observed = await sql<{ score: string; weight: string }>`SELECT score::text, weight::text FROM observations`.execute(adminDb)
    expect(observed.rows).toHaveLength(1)
    expect(Number(observed.rows[0]?.score)).toBe(0.5)
    expect(Number(observed.rows[0]?.weight)).toBe(0.6)
  })

  it('kết nối worker không ghi được quyết định và không đọc được khóa đáp án', async () => {
    await expect(sql`SELECT key FROM question_keys`.execute(workerDb)).rejects.toThrow(/permission denied/i)
    await expect(sql`
      INSERT INTO attainment_decisions (school_id, learner_id, offering_id, requirement_id, decision, review_id, decided_by)
      VALUES (${schools.an.id}, ${personas.hsMinh.subject}, ${offerings.tin10a1.id}, ${randomUUID()}, 'achieved', ${randomUUID()}, ${personas.gvLan.subject})
    `.execute(workerDb)).rejects.toThrow(/permission denied/i)
  })

  it('B01 chỉ KC observable có quan sát', async () => {
    const required = await approvedKc('KC-TIN10-CAULENH')
    const observable = await approvedKc('KC-TIN10-KIEMTHU')
    const responseId = await seedResponse({ purpose: 'diagnostic', tryNo: 1, correct: true, points: '1.000', kcRequired: required, kcObservable: observable })
    await enqueueAnswered([responseId])
    await drain()
    const rows = await sql<{ kc_version_id: string }>`SELECT kc_version_id::text FROM observations`.execute(adminDb)
    expect(rows.rows.map((row) => row.kc_version_id)).toEqual([observable])
  })

  it('B02 phát lại cùng sự kiện không thêm quan sát', async () => {
    const observable = await approvedKc('KC-TIN10-KIEMTHU')
    const responseId = await seedResponse({ purpose: 'diagnostic', tryNo: 1, correct: true, points: '1.000', kcObservable: observable })
    await enqueueAnswered([responseId])
    await enqueueAnswered([responseId])
    await drain()
    const count = await sql<{ n: number }>`SELECT count(*)::int AS n FROM observations`.execute(adminDb)
    expect(count.rows[0]?.n).toBe(1)
  })

  it('trọng số practice, diagnostic, provisional, notLearned và short_text', async () => {
    const observable = await approvedKc('KC-TIN10-KIEMTHU')
    const plain = await seedResponse({ purpose: 'practice', tryNo: 1, hints: 0, correct: true, points: '1.000', kcObservable: observable })
    const hinted = await seedResponse({ purpose: 'practice', tryNo: 1, hints: 1, correct: true, points: '1.000', kcObservable: observable })
    const third = await seedResponse({ purpose: 'practice', tryNo: 3, correct: false, points: '0.000', kcObservable: observable })
    const fourth = await seedResponse({ purpose: 'practice', tryNo: 4, correct: true, points: '1.000', kcObservable: observable })
    const diagnostic = await seedResponse({ purpose: 'diagnostic', tryNo: 1, correct: true, points: '1.000', kcObservable: observable, submitted: true })
    const provisional = await seedResponse({ purpose: 'diagnostic', tryNo: 1, correct: false, points: '0.000', kcObservable: observable, provisional: true, submitted: true })
    const skipped = await seedResponse({ purpose: 'diagnostic', tryNo: 1, correct: null, points: null, kcObservable: observable, response: { notLearned: true }, submitted: true })
    const manual = await seedResponse({ purpose: 'practice', tryNo: 1, correct: null, points: null, kcObservable: observable, qtype: 'short_text' })
    await enqueueAnswered([plain, hinted, third, fourth, diagnostic, provisional, skipped, manual])
    await drain()
    const rows = await sql<{ source_ref: string; weight: string }>`SELECT source_ref, weight::text FROM observations ORDER BY source_ref`.execute(adminDb)
    const weight = new Map(rows.rows.map((row) => [row.source_ref, Number(row.weight)]))
    expect(weight.get(`response:${plain}`)).toBe(0.6)
    expect(weight.get(`response:${hinted}`)).toBe(0.3)
    expect(weight.get(`response:${third}`)).toBe(0.2)
    expect(weight.has(`response:${fourth}`)).toBe(false)
    expect(weight.get(`response:${diagnostic}`)).toBe(0.7)
    expect(weight.get(`response:${provisional}`)).toBe(0.35)
    expect(weight.has(`response:${skipped}`)).toBe(false)
    expect(weight.has(`response:${manual}`)).toBe(false)
  })

  it('C05 not_shown và tiêu chí không gắn KC không có quan sát', async () => {
    const observable = await approvedKc('KC-TIN10-KIEMTHU')
    await seedReview([
      { level: 'not_shown', kcVersionId: observable },
      { level: 'meets', kcVersionId: null },
      { level: 'developing', kcVersionId: observable },
    ])
    await drain()
    const rows = await sql<{ score: string }>`SELECT score::text FROM observations`.execute(adminDb)
    expect(rows.rows).toHaveLength(1)
    expect(Number(rows.rows[0]?.score)).toBe(0.5)
  })

  it('C03 hai câu khác nhau thành signal, hai lần cùng câu là seen_once', async () => {
    const misconception = await adminDb.selectFrom('misconceptions').select('id').where('code', '=', 'M-TIN10-CAULENH').executeTakeFirstOrThrow()
    const observable = await approvedKc('KC-TIN10-KIEMTHU')
    const first = await seedResponse({ purpose: 'practice', tryNo: 1, correct: false, points: '0.000', kcObservable: observable, misconceptionId: misconception.id })
    const same = await seedResponse({ purpose: 'practice', tryNo: 2, correct: false, points: '0.000', kcObservable: observable, misconceptionId: misconception.id, sameQuestionAs: first })
    await enqueueAnswered([first, same])
    await drain()
    const once = await sql<{ status: string; distinct_items: number }>`SELECT status, distinct_items FROM misconception_signals`.execute(adminDb)
    expect(once.rows[0]?.status).toBe('seen_once')
    expect(once.rows[0]?.distinct_items).toBe(1)
    const other = await seedResponse({ purpose: 'practice', tryNo: 1, correct: false, points: '0.000', kcObservable: observable, misconceptionId: misconception.id })
    await enqueueAnswered([other])
    await drain()
    const signal = await sql<{ status: string; distinct_items: number }>`SELECT status, distinct_items FROM misconception_signals`.execute(adminDb)
    expect(signal.rows).toHaveLength(1)
    expect(signal.rows[0]?.status).toBe('signal')
    expect(signal.rows[0]?.distinct_items).toBe(2)
  })

  it('B03 ước lượng strong không tạo attainment_decisions', async () => {
    const observable = await approvedKc('KC-TIN10-KIEMTHU')
    const ids = []
    for (let index = 0; index < 3; index += 1) {
      ids.push(await seedResponse({ purpose: 'diagnostic', tryNo: 1, correct: true, points: '1.000', kcObservable: observable, submitted: true }))
    }
    await enqueueAnswered(ids)
    await drain()
    const estimate = await sql<{ status: string }>`SELECT status FROM needs_estimates`.execute(adminDb)
    expect(estimate.rows.some((row) => row.status === 'strong')).toBe(true)
    const decisions = await sql<{ n: number }>`SELECT count(*)::int AS n FROM attainment_decisions`.execute(adminDb)
    expect(decisions.rows[0]?.n).toBe(0)
  })

  it('B06 chuỗi tiên quyết dài hơn 3 bước có capped', async () => {
    const requirement = await requirementId()
    const codes = ['KC-M8-A', 'KC-M8-B', 'KC-M8-C', 'KC-M8-D', 'KC-M8-E']
    const versions: string[] = []
    for (const code of codes) versions.push(await insertKc(code))
    for (let index = 0; index < versions.length - 1; index += 1) {
      const from = versions[index]
      const to = versions[index + 1]
      if (!from || !to) continue
      await sql`
        INSERT INTO kc_edges (from_kc_version_id, to_kc_version_id, edge_type, status, source, reviewed_by)
        VALUES (${from}, ${to}, 'prerequisite', 'approved', 'expert', ${personas.gvLan.subject})
      `.execute(adminDb)
    }
    for (const version of versions) {
      await sql`
        INSERT INTO requirement_kc_links (requirement_id, kc_version_id, coverage, status, source, reviewed_by)
        VALUES (${requirement}, ${version}, 'full', 'approved', 'expert', ${personas.gvLan.subject})
      `.execute(adminDb)
      await sql`
        INSERT INTO needs_estimates (school_id, learner_id, offering_id, kc_version_id, status, value, n_observations, model_version, observation_ids)
        VALUES (${schools.an.id}, ${personas.hsMinh.subject}, ${offerings.tin10a1.id}, ${version}, 'needs_support', 0.2, 2, 'R0@1.0.0', '{}')
      `.execute(adminDb)
    }
    const moduleId = randomUUID()
    const versionId = randomUUID()
    const itemId = randomUUID()
    const pathId = randomUUID()
    const releaseId = randomUUID()
    await sql`INSERT INTO modules (id, school_id, course_id, owner_id) VALUES (${moduleId}, ${schools.an.id}, ${courses.tin10.id}, ${personas.gvLan.subject})`.execute(adminDb)
    await sql`
      INSERT INTO module_versions (id, school_id, module_id, version_no, title, requirement_ids, coverage_report, digest, published_by)
      VALUES (${versionId}, ${schools.an.id}, ${moduleId}, 1, 'Chuỗi', ${sql`ARRAY[${requirement}]::uuid[]`}, '{}'::jsonb, 'abc', ${personas.gvLan.subject})
    `.execute(adminDb)
    await sql`
      INSERT INTO module_items (id, module_version_id, position, item_type, title, completion_rule, requirement_ids)
      VALUES (${itemId}, ${versionId}, 0, 'page', 'Trang', 'none', '{}')
    `.execute(adminDb)
    await sql`
      INSERT INTO path_releases (id, school_id, offering_id, title, created_by)
      VALUES (${pathId}, ${schools.an.id}, ${offerings.tin10a1.id}, 'Đợt', ${personas.gvLan.subject})
    `.execute(adminDb)
    await sql`
      INSERT INTO module_releases (id, school_id, offering_id, path_release_id, module_version_id, position, available_from)
      VALUES (${releaseId}, ${schools.an.id}, ${offerings.tin10a1.id}, ${pathId}, ${versionId}, 0, '2020-01-01')
    `.execute(adminDb)
    const teacher = await session(personas.gvLan.subject, 'teacher')
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/offerings/${offerings.tin10a1.id}/heatmap`,
      headers: headers(teacher),
    })
    expect(response.statusCode, response.body).toBe(200)
    const body = response.json() as { rootGaps: { groups: { capped: boolean }[] }[]; modelVersion: string; lastUpdatedAt: string | null }
    expect(body.modelVersion).toBe('R0@1.0.0')
    expect(body.lastUpdatedAt).toBeTruthy()
    expect(body.rootGaps.some((row) => row.groups.some((group) => group.capped))).toBe(true)
  })

  it('B08 phụ huynh gọi nhu cầu của con thì 404', async () => {
    const guardian = await session(personas.phMinh.subject, 'guardian')
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/learners/${personas.hsMinh.subject}/needs?offeringId=${offerings.tin10a1.id}`,
      headers: headers(guardian),
    })
    expect(response.statusCode).toBe(404)
    const student = await session(personas.hsMinh.subject, 'student')
    const heatmap = await app.inject({
      method: 'GET',
      url: `/api/v1/offerings/${offerings.tin10a1.id}/heatmap`,
      headers: headers(student),
    })
    expect(heatmap.statusCode).toBe(404)
  })

  it('B10 A18 FEATURE_AI=false vẫn học, chấm và R0', async () => {
    expect(featureAiEnabled(process.env)).toBe(false)
    const observable = await approvedKc('KC-TIN10-CAULENH')
    const quiz = await publishQuiz([{
      clientKey: 'c',
      qtype: 'single_choice',
      stem: rich('Câu'),
      options: [{ id: 'a', label: 'Đúng' }, { id: 'b', label: 'Sai' }],
      answerKey: { option: 'a' },
      kcRequired: [],
      kcObservable: [observable],
      bloomTarget: 2,
      hints: ['Gợi ý'],
    }])
    const student = await session(personas.hsMinh.subject, 'student')
    const started = await app.inject({
      method: 'POST',
      url: `/api/v1/module-releases/${quiz.releaseId}/items/${quiz.itemId}/attempts`,
      headers: headers(student, { 'idempotency-key': randomUUID(), 'content-type': 'application/json' }),
      payload: {},
    })
    expect(started.statusCode, started.body).toBe(201)
    const attemptId = started.json().id as string
    const saved = await app.inject({
      method: 'POST',
      url: `/api/v1/attempts/${attemptId}/questions/${quiz.questionIds[0] ?? ''}/answers`,
      headers: headers(student, { 'idempotency-key': randomUUID(), 'content-type': 'application/json' }),
      payload: { response: { option: 'a' } },
    })
    expect(saved.statusCode, saved.body).toBe(200)
    const second = await seedResponse({ purpose: 'diagnostic', tryNo: 1, correct: true, points: '1.000', kcObservable: observable, submitted: true })
    await enqueueAnswered([second])
    await drain()
    const teacher = await session(personas.gvLan.subject, 'teacher')
    const needs = await app.inject({
      method: 'GET',
      url: `/api/v1/learners/${personas.hsMinh.subject}/needs?offeringId=${offerings.tin10a1.id}`,
      headers: headers(teacher),
    })
    expect(needs.statusCode, needs.body).toBe(200)
    const items = needs.json() as { value?: number | null; status: string }[]
    expect(items.length).toBeGreaterThan(0)
    expect(items[0]).toHaveProperty('value')
    const own = await app.inject({
      method: 'GET',
      url: `/api/v1/learners/${personas.hsMinh.subject}/needs?offeringId=${offerings.tin10a1.id}`,
      headers: headers(student),
    })
    expect(own.statusCode).toBe(200)
    expect(JSON.stringify(own.json())).not.toContain('"value"')
  })

  it('B11 recompute mô hình mới giữ hàng cũ', async () => {
    const observable = await approvedKc('KC-TIN10-KIEMTHU')
    const first = await seedResponse({ purpose: 'diagnostic', tryNo: 1, correct: true, points: '1.000', kcObservable: observable, submitted: true })
    const second = await seedResponse({ purpose: 'diagnostic', tryNo: 1, correct: true, points: '1.000', kcObservable: observable, submitted: true })
    await enqueueAnswered([first, second])
    await drain()
    const before = await sql<{ model_version: string }>`SELECT model_version FROM needs_estimates ORDER BY id`.execute(adminDb)
    expect(before.rows.map((row) => row.model_version)).toEqual(['R0@1.0.0'])
    execFileSync('node', ['--experimental-strip-types', 'apps/worker/src/cli.ts', 'recompute', '--model', 'R0@1.1.0'], {
      env: { ...process.env, WORKER_DATABASE_URL: workerUrl(databaseUrl) },
    })
    const after = await sql<{ model_version: string }>`SELECT model_version FROM needs_estimates ORDER BY model_version`.execute(adminDb)
    expect(after.rows.map((row) => row.model_version).sort()).toEqual(['R0@1.0.0', 'R0@1.1.0'])
  })

  it('BACKFILL-01 chạy hai lần đủ quan sát và không trùng', async () => {
    const observable = await approvedKc('KC-TIN10-KIEMTHU')
    await seedResponse({ purpose: 'practice', tryNo: 1, correct: true, points: '1.000', kcObservable: observable })
    const early = await seedResponse({ purpose: 'diagnostic', tryNo: 1, correct: false, points: '0.000', kcObservable: observable, submitted: true })
    const latest = await seedResponse({ purpose: 'diagnostic', tryNo: 2, correct: true, points: '1.000', kcObservable: observable, submitted: true, sameQuestionAs: early })
    await sql`UPDATE outbox_events SET status = 'done', processed_at = now()`.execute(adminDb)
    const first = await backfillInsights(workerDb)
    const second = await backfillInsights(workerDb)
    expect(first.observations).toBeGreaterThan(0)
    expect(second.observations).toBe(0)
    const refs = await sql<{ source_ref: string }>`SELECT source_ref FROM observations`.execute(adminDb)
    expect(refs.rows.some((row) => row.source_ref === `response:${latest}`)).toBe(true)
    const diagnosticRefs = refs.rows.filter((row) => row.source_ref.startsWith('response:'))
    expect(new Set(diagnosticRefs.map((row) => row.source_ref)).size).toBe(diagnosticRefs.length)
    expect(refs.rows.some((row) => row.source_ref === `response:${early}`)).toBe(false)
  })

  it('KC-VERSION hai version cùng KC thành một ô needs_current_kc', async () => {
    const code = `KC-M8-${randomUUID().slice(0, 8).toUpperCase()}`
    const kcId = randomUUID()
    const v1 = randomUUID()
    const v2 = randomUUID()
    await sql`INSERT INTO knowledge_components (id, code, subject_code, grade) VALUES (${kcId}, ${code}, '1401', 10)`.execute(adminDb)
    await sql`
      INSERT INTO kc_versions (id, kc_id, version_no, name, observable_criteria, status, source, reviewed_by)
      VALUES
        (${v1}, ${kcId}, 1, 'Cũ', 'Quan sát', 'superseded', 'expert', ${personas.gvLan.subject}),
        (${v2}, ${kcId}, 2, 'Mới', 'Quan sát', 'approved', 'expert', ${personas.gvLan.subject})
    `.execute(adminDb)
    const older = await seedResponse({ purpose: 'diagnostic', tryNo: 1, correct: true, points: '1.000', kcObservable: v1, submitted: true })
    const newer = await seedResponse({ purpose: 'diagnostic', tryNo: 1, correct: false, points: '0.000', kcObservable: v2, submitted: true })
    await enqueueAnswered([older, newer])
    await drain()
    const rows = await sql<{ n: number; kc_id: string }>`
      SELECT count(*)::int AS n, kc_id::text FROM needs_current_kc
       WHERE learner_id = ${personas.hsMinh.subject} AND model_version = 'R0@1.0.0' AND kc_id = ${kcId}
       GROUP BY kc_id
    `.execute(adminDb)
    expect(rows.rows[0]?.n).toBe(1)
  })

  async function insertKc(code: string): Promise<string> {
    const kcId = randomUUID()
    const versionId = randomUUID()
    await sql`INSERT INTO knowledge_components (id, code, subject_code, grade) VALUES (${kcId}, ${code}, '1401', 10)`.execute(adminDb)
    await sql`
      INSERT INTO kc_versions (id, kc_id, version_no, name, observable_criteria, status, source, reviewed_by)
      VALUES (${versionId}, ${kcId}, 1, ${code}, 'Quan sát được', 'approved', 'expert', ${personas.gvLan.subject})
    `.execute(adminDb)
    return versionId
  }

  async function seedResponse(input: {
    purpose: string
    tryNo: number
    correct: boolean | null
    points: string | null
    kcObservable: string
    kcRequired?: string
    hints?: number
    provisional?: boolean
    submitted?: boolean
    response?: Record<string, unknown>
    qtype?: string
    misconceptionId?: string
    sameQuestionAs?: string
    sameAttemptPurpose?: string
  }): Promise<string> {
    const moduleId = randomUUID()
    const versionId = randomUUID()
    const itemId = randomUUID()
    const assessmentId = randomUUID()
    const questionId = input.sameQuestionAs
      ? (await sql<{ question_item_id: string }>`SELECT question_item_id FROM question_responses WHERE id = ${input.sameQuestionAs}::bigint`.execute(adminDb)).rows[0]?.question_item_id
      : randomUUID()
    const pathId = randomUUID()
    const releaseId = randomUUID()
    const attemptId = randomUUID()
    if (!input.sameQuestionAs) {
      await sql`INSERT INTO modules (id, school_id, course_id, owner_id) VALUES (${moduleId}, ${schools.an.id}, ${courses.tin10.id}, ${personas.gvLan.subject})`.execute(adminDb)
      await sql`
        INSERT INTO module_versions (id, school_id, module_id, version_no, title, requirement_ids, coverage_report, digest, published_by)
        VALUES (${versionId}, ${schools.an.id}, ${moduleId}, 1, 'Bài', '{}', '{}'::jsonb, 'abc', ${personas.gvLan.subject})
      `.execute(adminDb)
      await sql`
        INSERT INTO module_items (id, module_version_id, position, item_type, title, completion_rule)
        VALUES (${itemId}, ${versionId}, 0, 'quiz', 'Quiz', 'submit')
      `.execute(adminDb)
      await sql`
        INSERT INTO assessment_versions (id, module_version_id, module_item_id, purpose, show_feedback, hints_enabled)
        VALUES (${assessmentId}, ${versionId}, ${itemId}, ${input.purpose}, 'immediate', ${input.purpose === 'practice'})
      `.execute(adminDb)
      await sql`
        INSERT INTO question_items (id, assessment_version_id, position, qtype, stem, options, bloom_target, hints, source, provisional)
        VALUES (${questionId}, ${assessmentId}, 0, ${input.qtype ?? 'single_choice'}, '{"format":"hcn-rich/1"}'::jsonb, '[{"id":"a"}]'::jsonb, 2, '[]'::jsonb, 'teacher', ${input.provisional ?? false})
      `.execute(adminDb)
      await sql`
        INSERT INTO path_releases (id, school_id, offering_id, title, created_by)
        VALUES (${pathId}, ${schools.an.id}, ${offerings.tin10a1.id}, 'Đợt', ${personas.gvLan.subject})
      `.execute(adminDb)
      await sql`
        INSERT INTO module_releases (id, school_id, offering_id, path_release_id, module_version_id, position, available_from)
        VALUES (${releaseId}, ${schools.an.id}, ${offerings.tin10a1.id}, ${pathId}, ${versionId}, 0, '2020-01-01')
      `.execute(adminDb)
      await sql`
        INSERT INTO question_kc_links (question_item_id, kc_version_id, role) VALUES (${questionId}, ${input.kcObservable}, 'observable')
      `.execute(adminDb)
      if (input.kcRequired) {
        await sql`
          INSERT INTO question_kc_links (question_item_id, kc_version_id, role) VALUES (${questionId}, ${input.kcRequired}, 'required')
        `.execute(adminDb)
      }
    }
    const located = input.sameQuestionAs
      ? await sql<{ attempt_id: string }>`SELECT attempt_id FROM question_responses WHERE id = ${input.sameQuestionAs}::bigint`.execute(adminDb)
      : null
    const attempt = located?.rows[0]?.attempt_id ?? attemptId
    if (!located?.rows[0]) {
      const release = input.sameQuestionAs
        ? ''
        : releaseId
      const assessment = assessmentId
      await sql`
        INSERT INTO quiz_attempts (id, school_id, learner_id, module_release_id, assessment_version_id, attempt_no, status, submitted_at)
        VALUES (
          ${attempt}, ${schools.an.id}, ${personas.hsMinh.subject},
          ${release}, ${assessment}, 1,
          ${input.submitted || input.purpose !== 'practice' ? 'submitted' : 'in_progress'},
          ${input.submitted || input.purpose !== 'practice' ? new Date() : null}
        )
      `.execute(adminDb)
    }
    const inserted = await sql<{ id: string }>`
      INSERT INTO question_responses (school_id, attempt_id, question_item_id, try_no, response, correct, points, hints_used, misconception_id)
      VALUES (
        ${schools.an.id}, ${attempt}, ${questionId}, ${input.tryNo},
        ${JSON.stringify(input.response ?? { option: 'a' })}::jsonb,
        ${input.correct}, ${input.points}, ${input.hints ?? 0}, ${input.misconceptionId ?? null}
      )
      RETURNING id::text
    `.execute(adminDb)
    return inserted.rows[0]?.id ?? ''
  }

  async function enqueueAnswered(responseIds: string[]): Promise<void> {
    await sql`
      INSERT INTO outbox_events (school_id, aggregate_type, aggregate_id, event_type, payload)
      VALUES (
        ${schools.an.id}, 'quiz_attempt', ${randomUUID()}, 'QuestionAnswered',
        ${JSON.stringify({ responseIds: responseIds.join(','), learnerId: personas.hsMinh.subject, offeringId: offerings.tin10a1.id, purpose: 'practice' })}::jsonb
      )
    `.execute(adminDb)
  }

  async function seedReview(criteria: { level: string; kcVersionId: string | null }[]): Promise<void> {
    const moduleId = randomUUID()
    const versionId = randomUUID()
    const itemId = randomUUID()
    const rubricId = randomUUID()
    const pathId = randomUUID()
    const releaseId = randomUUID()
    const submissionId = randomUUID()
    const submissionVersionId = randomUUID()
    const reviewId = randomUUID()
    await sql`INSERT INTO modules (id, school_id, course_id, owner_id) VALUES (${moduleId}, ${schools.an.id}, ${courses.tin10.id}, ${personas.gvLan.subject})`.execute(adminDb)
    await sql`
      INSERT INTO module_versions (id, school_id, module_id, version_no, title, requirement_ids, coverage_report, digest, published_by)
      VALUES (${versionId}, ${schools.an.id}, ${moduleId}, 1, 'Bài', '{}', '{}'::jsonb, 'abc', ${personas.gvLan.subject})
    `.execute(adminDb)
    await sql`INSERT INTO rubric_versions (id, module_version_id, title) VALUES (${rubricId}, ${versionId}, 'Rubric')`.execute(adminDb)
    await sql`
      INSERT INTO module_items (id, module_version_id, position, item_type, title, completion_rule, rubric_version_id)
      VALUES (${itemId}, ${versionId}, 0, 'assignment', 'Bài', 'submit', ${rubricId})
    `.execute(adminDb)
    await sql`
      INSERT INTO path_releases (id, school_id, offering_id, title, created_by)
      VALUES (${pathId}, ${schools.an.id}, ${offerings.tin10a1.id}, 'Đợt', ${personas.gvLan.subject})
    `.execute(adminDb)
    await sql`
      INSERT INTO module_releases (id, school_id, offering_id, path_release_id, module_version_id, position, available_from)
      VALUES (${releaseId}, ${schools.an.id}, ${offerings.tin10a1.id}, ${pathId}, ${versionId}, 0, '2020-01-01')
    `.execute(adminDb)
    await sql`
      INSERT INTO submissions (id, school_id, learner_id, module_release_id, module_item_id, status, current_version_no)
      VALUES (${submissionId}, ${schools.an.id}, ${personas.hsMinh.subject}, ${releaseId}, ${itemId}, 'reviewed', 1)
    `.execute(adminDb)
    await sql`
      INSERT INTO submission_versions (id, submission_id, version_no, body, content_hash)
      VALUES (${submissionVersionId}, ${submissionId}, 1, '{"type":"text","text":"bài"}'::jsonb, ${'a'.repeat(64)})
    `.execute(adminDb)
    await sql`
      INSERT INTO reviews (id, school_id, submission_id, submission_version_id, rubric_version_id, reviewer_id, status)
      VALUES (${reviewId}, ${schools.an.id}, ${submissionId}, ${submissionVersionId}, ${rubricId}, ${personas.gvLan.subject}, 'draft')
    `.execute(adminDb)
    for (const [index, criterion] of criteria.entries()) {
      const criterionId = randomUUID()
      await sql`
        INSERT INTO rubric_criteria (id, rubric_version_id, position, title, kc_version_id, level_meets, level_developing, level_not_yet)
        VALUES (${criterionId}, ${rubricId}, ${index}, ${`Tiêu chí ${String(index)}`}, ${criterion.kcVersionId}, 'Rõ', 'Tạm', 'Chưa')
      `.execute(adminDb)
      await sql`
        INSERT INTO review_criterion_results (review_id, rubric_criterion_id, level)
        VALUES (${reviewId}, ${criterionId}, ${criterion.level})
      `.execute(adminDb)
    }
    await sql`
      UPDATE reviews SET status = 'published', outcome = 'reviewed', published_at = now() WHERE id = ${reviewId}
    `.execute(adminDb)
    await sql`
      INSERT INTO outbox_events (school_id, aggregate_type, aggregate_id, event_type, payload)
      VALUES (${schools.an.id}, 'review', ${reviewId}, 'ReviewPublished', ${JSON.stringify({ reviewId, learnerId: personas.hsMinh.subject, offeringId: offerings.tin10a1.id, title: 'Bài' })}::jsonb)
    `.execute(adminDb)
  }
})
