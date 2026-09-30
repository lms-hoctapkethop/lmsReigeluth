import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'kysely'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb, type Database } from '@hcn/db'
import type { Kysely } from 'kysely'
import { courses, offerings, personas, schools, seedIdentity } from '@hcn/testkit/identity'
import { startPostgres18, type Postgres18 } from '@hcn/testkit'
import type { FastifyInstance } from 'fastify'
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
if (process.env.CI === 'true' && !ready) throw new Error('Job CI cần Docker và dbmate để chạy quiz')

const appOrigin = 'http://127.0.0.1:4319'
const issuer = 'http://idp.test/realms/hcn'
const sentinel = 'zq-sentinel-7781'
type Auth = { cookie: string; csrf: string }
type Role = 'teacher' | 'student'

function rich(text: string) {
  return { format: 'hcn-rich/1', blocks: [{ type: 'paragraph', children: [{ text }] }] }
}

function scrubSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubSecrets)
  if (!value || typeof value !== 'object') return value
  const row = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(row)) {
    if (key === 'label' || key === 'stem' || key === 'openedHints' || key === 'text') continue
    out[key] = scrubSecrets(child)
  }
  return out
}

describe.skipIf(!ready)('quiz M6', () => {
  let postgres: Postgres18
  let adminDb: Kysely<Database>
  let db: Kysely<Database>
  let app: FastifyInstance
  let kc = ''
  let requirement = ''
  let misconception = ''

  beforeAll(async () => {
    postgres = await startPostgres18()
    const cloned = await postgres.cloneDatabase('quiz_api')
    adminDb = createDb(cloned.url)
    db = createDb(cloned.appUrl)
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
    app = await buildApp({ config, db })
  }, 300_000)

  beforeEach(async () => {
    delete process.env.HCN_NOW
    await sql`
      TRUNCATE attempt_hint_usage, question_responses, quiz_attempts, attainment_decisions,
        submission_version_files, submission_versions, submissions, activity_progress, content_files, files,
        release_schedule_changes, module_releases, path_releases, processed_events, outbox_events,
        option_misconceptions, question_kc_links, question_keys, question_items, assessment_versions,
        module_items, rubric_criteria, rubric_versions, module_versions, module_drafts, module_collaborators, modules,
        idempotency_keys, sessions, audit_log
      RESTART IDENTITY CASCADE
    `.execute(adminDb)
    await seedIdentity(adminDb, { issuer })
    const req = await adminDb.selectFrom('curriculum_requirements').select('id').where('code791_stem', '=', '140110.0601a').executeTakeFirstOrThrow()
    const version = await adminDb
      .selectFrom('kc_versions')
      .innerJoin('knowledge_components', 'knowledge_components.id', 'kc_versions.kc_id')
      .select('kc_versions.id')
      .where('knowledge_components.code', '=', 'KC-TIN10-CAULENH')
      .where('kc_versions.status', '=', 'approved')
      .executeTakeFirstOrThrow()
    const miss = await adminDb.selectFrom('misconceptions').select('id').where('code', '=', 'M-TIN10-CAULENH').executeTakeFirstOrThrow()
    requirement = req.id
    kc = version.id
    misconception = miss.id
  })

  afterEach(() => {
    delete process.env.HCN_NOW
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

  function choice(clientKey: string, label = 'Sai', key = 'a', hints: string[] = ['Gợi ý 1']) {
    return {
      clientKey,
      qtype: 'single_choice',
      stem: rich('Câu'),
      options: [{ id: 'a', label: 'Đúng' }, { id: 'b', label }],
      answerKey: { option: key },
      kcRequired: [],
      kcObservable: [kc],
      bloomTarget: 2,
      hints,
      optionMisconceptions: { b: misconception },
    }
  }

  function numeric(clientKey: string, value: string) {
    return {
      clientKey,
      qtype: 'numeric',
      stem: rich('Số'),
      answerKey: { value, tolerance: '0' },
      kcRequired: [],
      kcObservable: [kc],
      bloomTarget: 2,
      hints: ['Viết bằng dấu phẩy'],
    }
  }

  async function publishQuiz(
    purpose: string,
    questions: Record<string, unknown>[],
    extra: { showFeedback?: string; hintsEnabled?: boolean; maxAttempts?: number | null; dueAt?: string } = {},
  ) {
    const teacher = await session(personas.gvLan.subject, 'teacher')
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/modules',
      headers: headers(teacher),
      payload: { courseId: courses.tin10.id, title: 'Quiz', requirementIds: [requirement] },
    })
    expect(created.statusCode, created.body).toBe(201)
    const moduleId = created.json().moduleId as string
    const saved = await app.inject({
      method: 'PUT',
      url: `/api/v1/modules/${moduleId}/draft`,
      headers: headers(teacher, { 'if-match': 'W/"1"' }),
      payload: {
        schema: 'module-draft/1',
        title: 'Quiz',
        requirementIds: [requirement],
        items: [{
          clientKey: 'q',
          type: 'quiz',
          title: 'Quiz',
          indent: 0,
          completion: 'submit',
          assessment: {
            purpose,
            showFeedback: extra.showFeedback ?? (purpose === 'practice' ? 'immediate' : 'after_submit'),
            hintsEnabled: extra.hintsEnabled ?? purpose === 'practice',
            maxAttempts: extra.maxAttempts === undefined
              ? (purpose === 'practice' || purpose === 'self_assessment' || purpose === 'summative' ? null : 1)
              : extra.maxAttempts,
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
      payload: {
        expectedRevision: 2,
        acknowledgements: [{ code: 'V02', target: requirement, reason: 'Quiz chưa có sản phẩm.' }],
      },
    })
    expect(published.statusCode, published.body).toBe(201)
    const versionId = published.json().id as string
    const released = await app.inject({
      method: 'POST',
      url: `/api/v1/offerings/${offerings.tin10a1.id}/path-releases`,
      headers: headers(teacher, { 'idempotency-key': randomUUID() }),
      payload: {
        title: 'Đợt',
        modules: [{ moduleVersionId: versionId, availableFrom: '2020-01-01T00:00:00.000Z', ...(extra.dueAt ? { dueAt: extra.dueAt } : {}) }],
      },
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

  async function start(auth: Auth, releaseId: string, itemId: string, key = randomUUID(), payload: Record<string, unknown> = {}) {
    return app.inject({
      method: 'POST',
      url: `/api/v1/module-releases/${releaseId}/items/${itemId}/attempts`,
      headers: headers(auth, { 'idempotency-key': key, 'content-type': 'application/json' }),
      payload,
    })
  }

  async function answer(auth: Auth, attemptId: string, questionId: string, response: Record<string, unknown>, key = randomUUID(), extra: Record<string, unknown> = {}) {
    return app.inject({
      method: 'POST',
      url: `/api/v1/attempts/${attemptId}/questions/${questionId}/answers`,
      headers: headers(auth, { 'idempotency-key': key, 'content-type': 'application/json' }),
      payload: { response, ...extra },
    })
  }

  async function submit(auth: Auth, attemptId: string, payload: Record<string, unknown> = {}, key = randomUUID()) {
    return app.inject({
      method: 'POST',
      url: `/api/v1/attempts/${attemptId}/submit`,
      headers: headers(auth, { 'idempotency-key': key, 'content-type': 'application/json' }),
      payload,
    })
  }

  it('P1a-05 lượt 0/4 vẫn completed', async () => {
    const student = await session(personas.hsMinh.subject, 'student')
    const quiz = await publishQuiz('practice', [choice('c1'), choice('c2'), choice('c3'), choice('c4')])
    const started = await start(student, quiz.releaseId, quiz.itemId)
    expect(started.statusCode, started.body).toBe(201)
    const attemptId = started.json().id as string
    for (const questionId of quiz.questionIds) {
      const row = await answer(student, attemptId, questionId, { option: 'b' })
      expect(row.statusCode, row.body).toBe(200)
      expect(row.json().correct).toBe(false)
    }
    const done = await submit(student, attemptId)
    expect(done.statusCode, done.body).toBe(200)
    expect(done.json().score).toBe(0)
    expect(done.json().maxScore).toBe(4)
    expect(done.json().status).toBe('submitted')
    const progress = await sql<{ status: string }>`
      SELECT status FROM activity_progress WHERE learner_id = ${personas.hsMinh.subject} AND module_item_id = ${quiz.itemId}
    `.execute(adminDb)
    expect(progress.rows[0]?.status).toBe('completed')
  })

  it('P1a-06 min_score hoặc KC gate thì 422 FEATURE_NOT_ENABLED', async () => {
    const student = await session(personas.hsMinh.subject, 'student')
    const quiz = await publishQuiz('practice', [choice('c1')])
    const minScore = await start(student, quiz.releaseId, quiz.itemId, randomUUID(), { minScore: 1 })
    expect(minScore.statusCode).toBe(422)
    expect(minScore.json().error.code).toBe('FEATURE_NOT_ENABLED')
    const gate = await start(student, quiz.releaseId, quiz.itemId, randomUUID(), { kcGate: true })
    expect(gate.statusCode).toBe(422)
    expect(gate.json().error.code).toBe('FEATURE_NOT_ENABLED')
    const count = await sql<{ n: number }>`SELECT count(*)::int AS n FROM quiz_attempts`.execute(adminDb)
    expect(count.rows[0]?.n).toBe(0)
  })

  it('P1a-10 AC09 điểm 4/4 không tạo attainment và body decision bị 422', async () => {
    const student = await session(personas.hsMinh.subject, 'student')
    const quiz = await publishQuiz('practice', [choice('c1'), choice('c2'), choice('c3'), choice('c4')])
    const started = await start(student, quiz.releaseId, quiz.itemId)
    const attemptId = started.json().id as string
    const rejected = await submit(student, attemptId, { decision: 'achieved' })
    expect(rejected.statusCode).toBe(422)
    const rejectedAttainment = await submit(student, attemptId, { attainment: true })
    expect(rejectedAttainment.statusCode).toBe(422)
    for (const questionId of quiz.questionIds) {
      expect((await answer(student, attemptId, questionId, { option: 'a' })).statusCode).toBe(200)
    }
    const done = await submit(student, attemptId)
    expect(done.json().score).toBe(4)
    expect(done.json().maxScore).toBe(4)
    const decisions = await sql<{ n: number }>`SELECT count(*)::int AS n FROM attainment_decisions`.execute(adminDb)
    expect(decisions.rows[0]?.n).toBe(0)
    expect(JSON.stringify(done.json())).not.toContain('correctAnswer')
  })

  it('C08 body correct hoặc score thì 422 và không có hàng', async () => {
    const student = await session(personas.hsMinh.subject, 'student')
    const quiz = await publishQuiz('practice', [choice('c1')])
    const started = await start(student, quiz.releaseId, quiz.itemId)
    const attemptId = started.json().id as string
    const questionId = quiz.questionIds[0] ?? ''
    const withCorrect = await answer(student, attemptId, questionId, { option: 'a' }, randomUUID(), { correct: true })
    expect(withCorrect.statusCode).toBe(422)
    const withScore = await answer(student, attemptId, questionId, { option: 'a' }, randomUUID(), { score: 1 })
    expect(withScore.statusCode).toBe(422)
    const rows = await sql<{ n: number }>`SELECT count(*)::int AS n FROM question_responses`.execute(adminDb)
    expect(rows.rows[0]?.n).toBe(0)
  })

  it('A14 số thập phân, phân số, từ chối định dạng và dấu trừ unicode', async () => {
    const student = await session(personas.hsMinh.subject, 'student')
    const quiz = await publishQuiz('practice', [numeric('n1', '1,5'), numeric('n2', '1,5'), numeric('n3', '1,5'), numeric('n4', '−0,5')])
    const started = await start(student, quiz.releaseId, quiz.itemId)
    const attemptId = started.json().id as string
    const [q1, q2, q3, q4] = quiz.questionIds
    const comma = await answer(student, attemptId, q1 ?? '', { raw: '1,5' })
    expect(comma.statusCode, comma.body).toBe(200)
    expect(comma.json().correct).toBe(true)
    const fraction = await answer(student, attemptId, q2 ?? '', { raw: '3/2' })
    expect(fraction.statusCode, fraction.body).toBe(200)
    expect(fraction.json().correct).toBe(true)
    for (const raw of ['1.000', '', 'abc', '1/0']) {
      const rejected = await answer(student, attemptId, q3 ?? '', { raw })
      expect(rejected.statusCode, raw).toBe(422)
      expect(rejected.json().error.code).toBe('VALIDATION_FAILED')
    }
    const minus = await answer(student, attemptId, q4 ?? '', { raw: '−0,5' })
    expect(minus.statusCode, minus.body).toBe(200)
    expect(minus.json().correct).toBe(true)
    const rows = await sql<{ n: number }>`SELECT count(*)::int AS n FROM question_responses WHERE question_item_id = ${q3 ?? ''}`.execute(adminDb)
    expect(rows.rows[0]?.n).toBe(0)
  })

  it('C04 hai gợi ý rồi trả lời thì hints_used = 2, gợi ý thứ 4 thì 409', async () => {
    const student = await session(personas.hsMinh.subject, 'student')
    const quiz = await publishQuiz('practice', [choice('c1', 'Sai', 'a', ['Một', 'Hai', 'Ba'])])
    const started = await start(student, quiz.releaseId, quiz.itemId)
    const attemptId = started.json().id as string
    const questionId = quiz.questionIds[0] ?? ''
    for (const level of [1, 2]) {
      const hint = await app.inject({
        method: 'POST',
        url: `/api/v1/attempts/${attemptId}/questions/${questionId}/hints`,
        headers: headers(student),
      })
      expect(hint.statusCode, hint.body).toBe(200)
      expect(hint.json().level).toBe(level)
    }
    const answered = await answer(student, attemptId, questionId, { option: 'b' })
    expect(answered.json().hintsUsed).toBe(2)
    const stored = await sql<{ hints_used: number }>`SELECT hints_used FROM question_responses WHERE attempt_id = ${attemptId}`.execute(adminDb)
    expect(stored.rows[0]?.hints_used).toBe(2)
    const third = await app.inject({
      method: 'POST',
      url: `/api/v1/attempts/${attemptId}/questions/${questionId}/hints`,
      headers: headers(student),
    })
    expect(third.statusCode).toBe(200)
    const fourth = await app.inject({
      method: 'POST',
      url: `/api/v1/attempts/${attemptId}/questions/${questionId}/hints`,
      headers: headers(student),
    })
    expect(fourth.statusCode).toBe(409)
    expect(fourth.json().error.code).toBe('ALREADY_ANSWERED')
    expect(fourth.json().error.details.reason).toBe('NO_MORE_HINTS')
  })

  it('PRACTICE-TRY sai hai lần rồi đúng, lần sau 409, cùng key không tăng try_no', async () => {
    const student = await session(personas.hsMinh.subject, 'student')
    const quiz = await publishQuiz('practice', [choice('c1')])
    const started = await start(student, quiz.releaseId, quiz.itemId)
    const attemptId = started.json().id as string
    const questionId = quiz.questionIds[0] ?? ''
    const key = randomUUID()
    const first = await answer(student, attemptId, questionId, { option: 'b' }, key)
    expect(first.json().tryNo).toBe(1)
    const replay = await answer(student, attemptId, questionId, { option: 'b' }, key)
    expect(replay.statusCode).toBe(200)
    expect(replay.json().tryNo).toBe(1)
    const second = await answer(student, attemptId, questionId, { option: 'b' })
    expect(second.json().tryNo).toBe(2)
    const third = await answer(student, attemptId, questionId, { option: 'a' })
    expect(third.json().tryNo).toBe(3)
    expect(third.json().correct).toBe(true)
    const again = await answer(student, attemptId, questionId, { option: 'b' })
    expect(again.statusCode).toBe(409)
    expect(again.json().error.code).toBe('ALREADY_ANSWERED')
    const rows = await sql<{ n: number }>`SELECT count(*)::int AS n FROM question_responses WHERE attempt_id = ${attemptId}`.execute(adminDb)
    expect(rows.rows[0]?.n).toBe(3)
  })

  it('DIAG-LAST chỉ hàng cuối được tính và không lộ đáp án', async () => {
    const student = await session(personas.hsMinh.subject, 'student')
    const quiz = await publishQuiz('diagnostic', [choice('c1')], { showFeedback: 'after_submit', hintsEnabled: false, maxAttempts: 1 })
    const started = await start(student, quiz.releaseId, quiz.itemId)
    const attemptId = started.json().id as string
    const questionId = quiz.questionIds[0] ?? ''
    const first = await answer(student, attemptId, questionId, { option: 'b' })
    expect(first.json().revealed).toBe(false)
    expect(first.json().correct).toBeNull()
    const second = await answer(student, attemptId, questionId, { option: 'a' })
    expect(second.json().revealed).toBe(false)
    expect(second.json().correct).toBeNull()
    const done = await submit(student, attemptId)
    expect(done.json().score).toBe(1)
    expect(JSON.stringify(done.json())).not.toContain('correctAnswer')
    expect(JSON.stringify(first.json())).not.toContain(sentinel)
    const rows = await sql<{ try_no: number; correct: boolean | null }>`
      SELECT try_no, correct FROM question_responses WHERE attempt_id = ${attemptId} ORDER BY try_no
    `.execute(adminDb)
    expect(rows.rows.map((row) => row.correct)).toEqual([false, true])
  })

  it('B05 notLearned trong diagnostic để correct NULL, trong practice thì 422', async () => {
    const student = await session(personas.hsMinh.subject, 'student')
    const diagnostic = await publishQuiz('diagnostic', [choice('c1')], { hintsEnabled: false, maxAttempts: 1, showFeedback: 'never' })
    const started = await start(student, diagnostic.releaseId, diagnostic.itemId)
    const attemptId = started.json().id as string
    const saved = await answer(student, attemptId, diagnostic.questionIds[0] ?? '', { notLearned: true })
    expect(saved.statusCode, saved.body).toBe(200)
    const row = await sql<{ correct: boolean | null }>`SELECT correct FROM question_responses WHERE attempt_id = ${attemptId}`.execute(adminDb)
    expect(row.rows[0]?.correct).toBeNull()
    const done = await submit(student, attemptId)
    expect(done.json().score).toBe(0)
    expect(done.json().maxScore).toBe(1)
    const practice = await publishQuiz('practice', [choice('c2')])
    const practiceStart = await start(student, practice.releaseId, practice.itemId)
    const rejected = await answer(student, practiceStart.json().id as string, practice.questionIds[0] ?? '', { notLearned: true })
    expect(rejected.statusCode).toBe(422)
    const extra = await sql<{ n: number }>`SELECT count(*)::int AS n FROM question_responses WHERE question_item_id = ${practice.questionIds[0] ?? ''}`.execute(adminDb)
    expect(extra.rows[0]?.n).toBe(0)
  })

  it('EXIT-FEEDBACK after_submit, after_due và never', async () => {
    const student = await session(personas.hsMinh.subject, 'student')
    const afterSubmit = await publishQuiz('exit_ticket', [choice('c1')], { showFeedback: 'after_submit', hintsEnabled: false, maxAttempts: 1 })
    const started = await start(student, afterSubmit.releaseId, afterSubmit.itemId)
    const attemptId = started.json().id as string
    const hidden = await answer(student, attemptId, afterSubmit.questionIds[0] ?? '', { option: 'a' })
    expect(hidden.json().revealed).toBe(false)
    const shown = await submit(student, attemptId)
    const state = (shown.json().questionStates as { revealed: boolean; correct: boolean }[])[0]
    expect(state?.revealed).toBe(true)
    expect(state?.correct).toBe(true)
    expect(JSON.stringify(shown.json())).not.toContain('correctAnswer')

    const afterDue = await publishQuiz('exit_ticket', [choice('c2')], { showFeedback: 'after_due', hintsEnabled: false, maxAttempts: 1, dueAt: '2099-01-01T00:00:00.000Z' })
    const dueStart = await start(student, afterDue.releaseId, afterDue.itemId)
    const dueId = dueStart.json().id as string
    await answer(student, dueId, afterDue.questionIds[0] ?? '', { option: 'b' })
    const beforeDue = await submit(student, dueId)
    expect((beforeDue.json().questionStates as { revealed: boolean }[])[0]?.revealed).toBe(false)
    process.env.HCN_NOW = '2100-01-02T00:00:00.000Z'
    const later = await app.inject({ method: 'GET', url: `/api/v1/attempts/${dueId}`, headers: headers(student) })
    expect((later.json().questionStates as { revealed: boolean; correct: boolean }[])[0]?.revealed).toBe(true)
    expect(JSON.stringify(later.json())).not.toContain('correctAnswer')
    delete process.env.HCN_NOW

    const never = await publishQuiz('exit_ticket', [choice('c3')], { showFeedback: 'never', hintsEnabled: false, maxAttempts: 1 })
    const neverStart = await start(student, never.releaseId, never.itemId)
    const neverId = neverStart.json().id as string
    await answer(student, neverId, never.questionIds[0] ?? '', { option: 'a' })
    const sealed = await submit(student, neverId)
    expect((sealed.json().questionStates as { revealed: boolean; correct?: boolean }[])[0]?.revealed).toBe(false)
    expect((sealed.json().questionStates as { correct?: boolean }[])[0]?.correct).toBeUndefined()
    expect(JSON.stringify(sealed.json())).not.toContain('correctAnswer')
  })

  it('RESUME startAttempt trả cùng lượt và questionStates', async () => {
    const student = await session(personas.hsMinh.subject, 'student')
    const quiz = await publishQuiz('practice', [choice('c1'), choice('c2'), choice('c3')])
    const started = await start(student, quiz.releaseId, quiz.itemId)
    const attemptId = started.json().id as string
    await answer(student, attemptId, quiz.questionIds[0] ?? '', { option: 'b' })
    await answer(student, attemptId, quiz.questionIds[1] ?? '', { option: 'a' })
    const againAuth = await session(personas.hsMinh.subject, 'student')
    const again = await start(againAuth, quiz.releaseId, quiz.itemId)
    expect(again.statusCode, again.body).toBe(201)
    expect(again.json().id).toBe(attemptId)
    const states = again.json().questionStates as { questionId: string; answered: boolean }[]
    expect(states.find((row) => row.questionId === quiz.questionIds[0])?.answered).toBe(true)
    expect(states.find((row) => row.questionId === quiz.questionIds[1])?.answered).toBe(true)
    expect(states.find((row) => row.questionId === quiz.questionIds[2])?.answered).toBe(false)
    const source = readFileSync(new URL('../../web/src/learn/quiz.tsx', import.meta.url), 'utf8')
    expect(source).not.toContain('localStorage')
    expect(source).not.toContain('sessionStorage')
  })

  it('CONCURRENCY hai answerQuestion khác key cùng câu practice', async () => {
    const student = await session(personas.hsMinh.subject, 'student')
    const quiz = await publishQuiz('practice', [choice('c1')])
    const started = await start(student, quiz.releaseId, quiz.itemId)
    const attemptId = started.json().id as string
    const questionId = quiz.questionIds[0] ?? ''
    const [left, right] = await Promise.all([
      answer(student, attemptId, questionId, { option: 'b' }, randomUUID()),
      answer(student, attemptId, questionId, { option: 'b' }, randomUUID()),
    ])
    expect(left.statusCode, left.body).toBe(200)
    expect(right.statusCode, right.body).toBe(200)
    expect([left.json().tryNo, right.json().tryNo].sort()).toEqual([1, 2])
    const rows = await sql<{ n: number }>`SELECT count(*)::int AS n FROM question_responses WHERE attempt_id = ${attemptId}`.execute(adminDb)
    expect(rows.rows[0]?.n).toBe(2)
  })

  it('ATTEMPT-LIMIT diagnostic lượt 2 thì 409', async () => {
    const student = await session(personas.hsMinh.subject, 'student')
    const quiz = await publishQuiz('diagnostic', [choice('c1')], { hintsEnabled: false, maxAttempts: 1, showFeedback: 'never' })
    const first = await start(student, quiz.releaseId, quiz.itemId)
    expect(first.statusCode).toBe(201)
    const done = await submit(student, first.json().id as string)
    expect(done.statusCode).toBe(200)
    const second = await start(student, quiz.releaseId, quiz.itemId)
    expect(second.statusCode).toBe(409)
    expect(second.json().error.code).toBe('ATTEMPT_LIMIT_REACHED')
  })

  it('SEC-08 A04 C09 không lộ chuỗi đáp án và vị trí phương án đúng', async () => {
    const student = await session(personas.hsMinh.subject, 'student')
    const quiz = await publishQuiz('practice', [
      {
        clientKey: 'short',
        qtype: 'short_text',
        stem: rich('Điền'),
        answerKey: { accept: [sentinel], caseSensitive: true },
        kcRequired: [],
        kcObservable: [kc],
        bloomTarget: 2,
        hints: ['Không phải khóa'],
      },
      {
        clientKey: 'choice',
        qtype: 'single_choice',
        stem: rich('Chọn'),
        options: [{ id: 'b', label: 'khác' }, { id: 'a', label: sentinel }],
        answerKey: { option: 'a' },
        kcRequired: [],
        kcObservable: [kc],
        bloomTarget: 2,
        hints: ['Nhìn đề'],
        optionMisconceptions: { b: misconception },
      },
    ])
    const bodies: { status: number; body: string; cache: string | undefined }[] = []
    const started = await start(student, quiz.releaseId, quiz.itemId)
    bodies.push({ status: started.statusCode, body: started.body, cache: started.headers['cache-control'] })
    const attemptId = started.json().id as string
    const loaded = await app.inject({ method: 'GET', url: `/api/v1/attempts/${attemptId}`, headers: headers(student) })
    bodies.push({ status: loaded.statusCode, body: loaded.body, cache: loaded.headers['cache-control'] })
    const options = (loaded.json().questions as { qtype: string; options?: { id: string; label: string }[] }[]).find((row) => row.qtype === 'single_choice')?.options ?? []
    expect(options.map((option) => option.id)).toEqual(['b', 'a'])
    expect(options.every((option) => Object.keys(option).sort().join() === 'id,label')).toBe(true)
    const wrong = await answer(student, attemptId, quiz.questionIds[1] ?? '', { option: 'b' })
    bodies.push({ status: wrong.statusCode, body: wrong.body, cache: wrong.headers['cache-control'] })
    const hint = await app.inject({
      method: 'POST',
      url: `/api/v1/attempts/${attemptId}/questions/${quiz.questionIds[1]}/hints`,
      headers: headers(student),
    })
    bodies.push({ status: hint.statusCode, body: hint.body, cache: hint.headers['cache-control'] })
    const done = await submit(student, attemptId)
    bodies.push({ status: done.statusCode, body: done.body, cache: done.headers['cache-control'] })
    for (const row of bodies) {
      expect(row.cache).toContain('no-store')
      const raw = row.body
      expect(raw).not.toMatch(/answerKey|correctAnswer|optionMisconceptions|kcRequired|kcObservable|rationale/)
      if (!raw.includes('"options"')) expect(raw).not.toContain(sentinel)
      expect(JSON.stringify(scrubSecrets(JSON.parse(raw)))).not.toContain(sentinel)
    }
    const web = new URL('../../web/src', import.meta.url)
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      return statSync(path).isDirectory() ? walk(path) : [path]
    })
    for (const file of walk(web.pathname)) {
      if (!/\.(tsx?|css|js|map|html)$/.test(file)) continue
      expect(readFileSync(file, 'utf8')).not.toContain(sentinel)
    }
  })

  it('answerQuestion lần thứ 61 trong một phút thì 429', async () => {
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
    })
    const student = await session(personas.hsAn.subject, 'student')
    let last = 0
    for (let index = 0; index < 61; index += 1) {
      const response = await limited.inject({
        method: 'POST',
        url: `/api/v1/attempts/${randomUUID()}/questions/${randomUUID()}/answers`,
        headers: headers(student, { 'idempotency-key': randomUUID(), 'content-type': 'application/json' }),
        payload: { response: { raw: '1' } },
      })
      last = response.statusCode
      if (index < 60) expect(response.statusCode).not.toBe(429)
    }
    expect(last).toBe(429)
    await limited.close()
  })
})
