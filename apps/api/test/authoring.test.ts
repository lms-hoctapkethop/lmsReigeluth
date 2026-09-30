import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { sql } from 'kysely'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb, type Database } from '@hcn/db'
import type { Kysely } from 'kysely'
import { courses, personas, seedIdentity } from '@hcn/testkit/identity'
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
if (process.env.CI === 'true' && !ready) throw new Error('Job CI cần Docker và dbmate để chạy soạn bài')

const appOrigin = 'http://127.0.0.1:4319'
const issuer = 'http://idp.test/realms/hcn'

type Auth = { cookie: string; csrf: string }

function rich(text: string) {
  return { format: 'hcn-rich/1', blocks: [{ type: 'paragraph', children: [{ text }] }] }
}

describe.skipIf(!ready)('soạn bài M4', () => {
  let postgres: Postgres18
  let adminDb: Kysely<Database>
  let db: Kysely<Database>
  let app: FastifyInstance

  beforeAll(async () => {
    postgres = await startPostgres18()
    const cloned = await postgres.cloneDatabase('authoring_api')
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
    await sql`
      TRUNCATE option_misconceptions, question_kc_links, question_keys, question_items, assessment_versions,
        module_items, rubric_criteria, rubric_versions, module_versions, module_drafts, module_collaborators, modules,
        curriculum_review_log, requirement_kc_links, kc_edges, misconceptions, kc_versions,
        knowledge_components, curriculum_requirements, curriculum_reviewers, idempotency_keys, sessions, audit_log
      RESTART IDENTITY CASCADE
    `.execute(adminDb)
    await seedIdentity(adminDb, { issuer })
  })

  afterAll(async () => {
    await app?.close()
    await db?.destroy()
    await adminDb?.destroy()
    await postgres?.stop()
  })

  async function session(userId: string): Promise<Auth> {
    const token = randomUUID()
    const hash = createHash('sha256').update(token).digest('hex')
    const csrf = randomUUID()
    await sql`
      INSERT INTO sessions (id_hash, user_id, csrf_token, context, created_at, last_seen_at, expires_at)
      VALUES (${hash}, ${userId}, ${csrf}, ${JSON.stringify({ school_id: '20000000-0000-4000-8000-000000000001', role: 'teacher' })}::jsonb, now(), now(), now() + interval '2 hours')
    `.execute(db)
    return { cookie: `hcn_sid=${token}`, csrf }
  }

  function headers(auth: Auth, extra: Record<string, string> = {}): Record<string, string> {
    return { cookie: auth.cookie, origin: appOrigin, 'x-csrf-token': auth.csrf, ...extra }
  }

  async function reqId(stem: string): Promise<string> {
    const row = await adminDb.selectFrom('curriculum_requirements').select('id').where('code791_stem', '=', stem).executeTakeFirstOrThrow()
    return row.id
  }

  async function kcId(code: string): Promise<string> {
    const row = await adminDb
      .selectFrom('kc_versions')
      .innerJoin('knowledge_components', 'knowledge_components.id', 'kc_versions.kc_id')
      .select('kc_versions.id')
      .where('knowledge_components.code', '=', code)
      .where('kc_versions.status', '=', 'approved')
      .orderBy('kc_versions.version_no', 'desc')
      .executeTakeFirstOrThrow()
    return row.id
  }

  async function misconceptionId(code: string): Promise<string> {
    const row = await adminDb.selectFrom('misconceptions').select('id').where('code', '=', code).executeTakeFirstOrThrow()
    return row.id
  }

  function choice(clientKey: string, observable: string[], misconception?: string) {
    return {
      clientKey,
      qtype: 'single_choice',
      stem: rich('Câu hỏi'),
      options: [{ id: 'a', label: 'Đúng' }, { id: 'b', label: 'Sai' }],
      answerKey: { option: 'a' },
      kcRequired: [],
      kcObservable: observable,
      bloomTarget: 2,
      hints: ['Nhớ điều kiện'],
      ...(misconception ? { optionMisconceptions: { b: misconception } } : {}),
    }
  }

  function quiz(clientKey: string, purpose: string, questions: Record<string, unknown>[]) {
    return {
      clientKey,
      type: 'quiz',
      title: 'Quiz',
      indent: 0,
      completion: 'submit',
      assessment: {
        purpose,
        maxAttempts: purpose === 'practice' ? null : 1,
        showFeedback: 'after_submit',
        hintsEnabled: purpose === 'practice',
        shuffleOptions: false,
        questions,
      },
    }
  }

  function draft(title: string, requirementIds: string[], items: Record<string, unknown>[]) {
    return { schema: 'module-draft/1' as const, title, requirementIds, items }
  }

  async function create(auth: Auth, courseId: string, title: string, requirementIds: string[]) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/modules',
      headers: headers(auth),
      payload: { courseId, title, requirementIds },
    })
    expect(response.statusCode).toBe(201)
    return response.json() as { moduleId: string; revision: number }
  }

  async function save(auth: Auth, moduleId: string, revision: number, payload: Record<string, unknown>) {
    return app.inject({
      method: 'PUT',
      url: `/api/v1/modules/${moduleId}/draft`,
      headers: headers(auth, { 'if-match': `W/"${revision}"` }),
      payload,
    })
  }

  async function publish(auth: Auth, moduleId: string, revision: number, key: string, acknowledgements: unknown[] = []) {
    return app.inject({
      method: 'POST',
      url: `/api/v1/modules/${moduleId}/versions`,
      headers: headers(auth, { 'idempotency-key': key }),
      payload: { expectedRevision: revision, acknowledgements },
    })
  }

  async function versionSnapshot(versionId: string): Promise<string> {
    const versions = await sql`SELECT id, module_id, version_no, title, description, requirement_ids, coverage_ack, digest, published_by FROM module_versions WHERE id = ${versionId}`.execute(adminDb)
    const items = await sql`SELECT * FROM module_items WHERE module_version_id = ${versionId} ORDER BY position`.execute(adminDb)
    const rubrics = await sql`SELECT * FROM rubric_versions WHERE module_version_id = ${versionId} ORDER BY title`.execute(adminDb)
    const criteria = await sql`SELECT c.* FROM rubric_criteria c JOIN rubric_versions r ON r.id = c.rubric_version_id WHERE r.module_version_id = ${versionId} ORDER BY c.position`.execute(adminDb)
    const assessments = await sql`SELECT * FROM assessment_versions WHERE module_version_id = ${versionId}`.execute(adminDb)
    const questions = await sql`SELECT q.* FROM question_items q JOIN assessment_versions a ON a.id = q.assessment_version_id WHERE a.module_version_id = ${versionId} ORDER BY q.position`.execute(adminDb)
    const keys = await sql`SELECT k.* FROM question_keys k JOIN question_items q ON q.id = k.question_item_id JOIN assessment_versions a ON a.id = q.assessment_version_id WHERE a.module_version_id = ${versionId}`.execute(adminDb)
    const links = await sql`SELECT l.* FROM question_kc_links l JOIN question_items q ON q.id = l.question_item_id JOIN assessment_versions a ON a.id = q.assessment_version_id WHERE a.module_version_id = ${versionId} ORDER BY l.role, l.kc_version_id`.execute(adminDb)
    const options = await sql`SELECT o.* FROM option_misconceptions o JOIN question_items q ON q.id = o.question_item_id JOIN assessment_versions a ON a.id = q.assessment_version_id WHERE a.module_version_id = ${versionId} ORDER BY o.option_id`.execute(adminDb)
    return JSON.stringify({ versions: versions.rows, items: items.rows, rubrics: rubrics.rows, criteria: criteria.rows, assessments: assessments.rows, questions: questions.rows, keys: keys.rows, links: links.rows, options: options.rows })
  }

  it('P1a-01 header page link assignment quiz thành 5 mục và 3 YCCĐ', async () => {
    const auth = await session(personas.gvLan.subject)
    const ids = [await reqId('140110.0101a'), await reqId('140110.0602a'), await reqId('140110.0603b')]
    const observable = [await kcId('KC-TIN10-RENHANH'), await kcId('KC-TIN10-LAP'), await kcId('KC-TIN10-KIEMTHU')]
    const created = await create(auth, courses.tin10.id, 'Năm mục', ids)
    const payload = draft('Năm mục', ids, [
      { clientKey: 'h', type: 'header', title: 'Mở', indent: 0, completion: 'none' },
      { clientKey: 'p', type: 'page', title: 'Trang', indent: 0, completion: 'view', body: rich('Đọc') },
      { clientKey: 'l', type: 'link', title: 'Nguồn', indent: 0, completion: 'view', url: 'https://example.edu.vn/nguon' },
      { clientKey: 'a', type: 'assignment', title: 'Nhiệm vụ', indent: 0, completion: 'submit', body: rich('Làm'), requirementIds: [] },
      quiz('q', 'diagnostic', [choice('c1', observable)]),
    ])
    const saved = await save(auth, created.moduleId, 1, payload)
    expect(saved.statusCode).toBe(200)
    const published = await publish(auth, created.moduleId, 2, 'p1a-01-key-0001')
    expect(published.statusCode).toBe(201)
    const count = await sql<{ n: number }>`SELECT count(*)::int AS n FROM module_items WHERE module_version_id = ${published.json().id}`.execute(adminDb)
    expect(count.rows[0]?.n).toBe(5)
    const requirements = await sql<{ n: number }>`SELECT cardinality(requirement_ids)::int AS n FROM module_versions WHERE id = ${published.json().id}`.execute(adminDb)
    expect(requirements.rows[0]?.n).toBe(3)
  })

  it('P1a-02 sửa nháp sau publish không đổi hàng của v1', async () => {
    const auth = await session(personas.gvLan.subject)
    const requirement = await reqId('140110.0101a')
    const observable = await kcId('KC-TIN10-RENHANH')
    const created = await create(auth, courses.tin10.id, 'Giữ v1', [requirement])
    const payload = draft('Giữ v1', [requirement], [quiz('q', 'diagnostic', [choice('c1', [observable])])])
    expect((await save(auth, created.moduleId, 1, payload)).statusCode).toBe(200)
    const published = await publish(auth, created.moduleId, 2, 'p1a-02-key-0001')
    expect(published.statusCode).toBe(201)
    const before = await versionSnapshot(published.json().id as string)
    const edited = draft('Đã sửa nháp', [requirement], [quiz('q', 'diagnostic', [choice('c1', [observable])])])
    expect((await save(auth, created.moduleId, 2, edited)).statusCode).toBe(200)
    expect(await versionSnapshot(published.json().id as string)).toBe(before)
  })

  it('P1a-08 hai lần lưu cùng revision: một 200, một 409, payload cuối hợp lệ', async () => {
    const auth = await session(personas.gvLan.subject)
    const created = await create(auth, courses.tin10.id, 'Song song', [])
    const left = draft('Bản A', [], [{ clientKey: 'h', type: 'header', title: 'A', indent: 0, completion: 'none' }])
    const right = draft('Bản B', [], [{ clientKey: 'h', type: 'header', title: 'B', indent: 0, completion: 'none' }])
    const [first, second] = await Promise.all([
      save(auth, created.moduleId, 1, left),
      save(auth, created.moduleId, 1, right),
    ])
    const codes = [first.statusCode, second.statusCode].sort()
    expect(codes).toEqual([200, 409])
    const conflict = first.statusCode === 409 ? first : second
    expect(conflict.json().error.code).toBe('REVISION_CONFLICT')
    expect(conflict.json().error.details.currentRevision).toBe(2)
    const current = await app.inject({ method: 'GET', url: `/api/v1/modules/${created.moduleId}/draft`, headers: headers(auth) })
    expect(current.statusCode).toBe(200)
    expect(['Bản A', 'Bản B']).toContain(current.json().payload.title)
    expect(current.json().payload.schema).toBe('module-draft/1')
  })

  it('AC08 C10 sửa rubric rồi publish v2 giữ rubric v1', async () => {
    const auth = await session(personas.gvLan.subject)
    const requirement = await reqId('140110.0101a')
    const observable = await kcId('KC-TIN10-RENHANH')
    const created = await create(auth, courses.tin10.id, 'Rubric', [requirement])
    const rubric = {
      title: 'Rubric gốc',
      criteria: [{ title: 'Đúng', kcVersionId: observable, levels: { meets: 'Đạt', developing: 'Đang', notYet: 'Chưa' } }],
    }
    const payload = draft('Rubric', [requirement], [
      quiz('q', 'diagnostic', [choice('c1', [observable])]),
      { clientKey: 'a', type: 'assignment', title: 'Bài', indent: 0, completion: 'submit', body: rich('Làm'), requirementIds: [requirement], rubric },
    ])
    expect((await save(auth, created.moduleId, 1, payload)).statusCode).toBe(200)
    const v1 = await publish(auth, created.moduleId, 2, 'ac08-key-00001')
    expect(v1.statusCode).toBe(201)
    const before = await versionSnapshot(v1.json().id as string)
    const next = draft('Rubric', [requirement], [
      quiz('q', 'diagnostic', [choice('c1', [observable])]),
      {
        clientKey: 'a',
        type: 'assignment',
        title: 'Bài',
        indent: 0,
        completion: 'submit',
        body: rich('Làm'),
        requirementIds: [requirement],
        rubric: { ...rubric, title: 'Rubric mới', criteria: [{ ...rubric.criteria[0], title: 'Tiêu chí mới' }] },
      },
    ])
    expect((await save(auth, created.moduleId, 2, next)).statusCode).toBe(200)
    const v2 = await publish(auth, created.moduleId, 3, 'ac08-key-00002')
    expect(v2.statusCode).toBe(201)
    expect(v2.json().versionNo).toBe(2)
    expect(await versionSnapshot(v1.json().id as string)).toBe(before)
  })

  it('AC16 module dự án 6 mục không theo khuôn 4 bước', async () => {
    const auth = await session(personas.gvLan.subject)
    const requirement = await reqId('140110.0101a')
    const observable = await kcId('KC-TIN10-RENHANH')
    const created = await create(auth, courses.tin10.id, 'Dự án', [requirement])
    const payload = draft('Dự án', [requirement], [
      { clientKey: 'h1', type: 'header', title: 'Bối cảnh', indent: 0, completion: 'none' },
      { clientKey: 'p1', type: 'page', title: 'Hồ sơ', indent: 0, completion: 'view', body: rich('Đọc hồ sơ') },
      { clientKey: 'p2', type: 'page', title: 'Số liệu', indent: 1, completion: 'self_mark', body: rich('Tự kiểm') },
      { clientKey: 'l', type: 'link', title: 'Nguồn mở', indent: 0, completion: 'view', url: 'https://example.edu.vn/du-an' },
      { clientKey: 'a', type: 'assignment', title: 'Sản phẩm', indent: 0, completion: 'submit', body: rich('Nộp sản phẩm'), requirementIds: [requirement] },
      quiz('q', 'diagnostic', [choice('c1', [observable])]),
    ])
    expect((await save(auth, created.moduleId, 1, payload)).statusCode).toBe(200)
    const published = await publish(auth, created.moduleId, 2, 'ac16-key-00001')
    expect(published.statusCode).toBe(201)
    const count = await sql<{ n: number }>`SELECT count(*)::int AS n FROM module_items WHERE module_version_id = ${published.json().id}`.execute(adminDb)
    expect(count.rows[0]?.n).toBe(6)
  })

  it('A07 hcn_test_app không sửa hoặc xóa hàng của v1', async () => {
    const auth = await session(personas.gvLan.subject)
    const requirement = await reqId('140110.0101a')
    const observable = await kcId('KC-TIN10-RENHANH')
    const mistake = await misconceptionId('M-TIN10-RENHANH')
    const created = await create(auth, courses.tin10.id, 'Bất biến', [requirement])
    const payload = draft('Bất biến', [requirement], [
      quiz('q', 'diagnostic', [choice('c1', [observable], mistake)]),
      {
        clientKey: 'a',
        type: 'assignment',
        title: 'Bài',
        indent: 0,
        completion: 'submit',
        body: rich('Làm'),
        requirementIds: [],
        rubric: { title: 'Rubric', criteria: [{ title: 'Đúng', kcVersionId: observable, levels: { meets: 'Đạt', developing: 'Đang', notYet: 'Chưa' } }] },
      },
    ])
    expect((await save(auth, created.moduleId, 1, payload)).statusCode).toBe(200)
    const published = await publish(auth, created.moduleId, 2, 'a07-key-0000001')
    expect(published.statusCode).toBe(201)
    const versionId = published.json().id as string
    const item = await adminDb.selectFrom('module_items').select('id').where('module_version_id', '=', versionId).executeTakeFirstOrThrow()
    const rubric = await adminDb.selectFrom('rubric_versions').select('id').where('module_version_id', '=', versionId).executeTakeFirstOrThrow()
    const criterion = await adminDb.selectFrom('rubric_criteria').select('id').where('rubric_version_id', '=', rubric.id).executeTakeFirstOrThrow()
    const assessment = await adminDb.selectFrom('assessment_versions').select('id').where('module_version_id', '=', versionId).executeTakeFirstOrThrow()
    const question = await adminDb.selectFrom('question_items').select('id').where('assessment_version_id', '=', assessment.id).executeTakeFirstOrThrow()
    const statements = [
      sql`UPDATE module_versions SET title = 'đổi' WHERE id = ${versionId}`,
      sql`DELETE FROM module_versions WHERE id = ${versionId}`,
      sql`UPDATE module_items SET title = 'đổi' WHERE id = ${item.id}`,
      sql`DELETE FROM module_items WHERE id = ${item.id}`,
      sql`UPDATE rubric_versions SET title = 'đổi' WHERE id = ${rubric.id}`,
      sql`DELETE FROM rubric_versions WHERE id = ${rubric.id}`,
      sql`UPDATE rubric_criteria SET title = 'đổi' WHERE id = ${criterion.id}`,
      sql`DELETE FROM rubric_criteria WHERE id = ${criterion.id}`,
      sql`UPDATE assessment_versions SET shuffle_options = true WHERE id = ${assessment.id}`,
      sql`DELETE FROM assessment_versions WHERE id = ${assessment.id}`,
      sql`UPDATE question_items SET bloom_target = 3 WHERE id = ${question.id}`,
      sql`DELETE FROM question_items WHERE id = ${question.id}`,
      sql`UPDATE question_keys SET key = '{"option":"b"}'::jsonb WHERE question_item_id = ${question.id}`,
      sql`DELETE FROM question_keys WHERE question_item_id = ${question.id}`,
      sql`UPDATE question_kc_links SET role = 'required' WHERE question_item_id = ${question.id} AND role = 'observable'`,
      sql`DELETE FROM question_kc_links WHERE question_item_id = ${question.id}`,
      sql`DELETE FROM option_misconceptions WHERE question_item_id = ${question.id}`,
    ]
    for (const statement of statements) await expect(statement.execute(db)).rejects.toThrow(/append-only/)
  })

  it('C01 thiếu quan sát thì 422 COVERAGE_BLOCKED đúng YCCĐ', async () => {
    const auth = await session(personas.gvLan.subject)
    const covered = await reqId('140110.0101a')
    const missing = await reqId('140110.0603b')
    const observable = await kcId('KC-TIN10-RENHANH')
    const created = await create(auth, courses.tin10.id, 'Thiếu phủ', [covered, missing])
    const payload = draft('Thiếu phủ', [covered, missing], [quiz('q', 'diagnostic', [choice('c1', [observable])])])
    expect((await save(auth, created.moduleId, 1, payload)).statusCode).toBe(200)
    const published = await publish(auth, created.moduleId, 2, 'c01-key-0000001')
    expect(published.statusCode).toBe(422)
    expect(published.json().error.code).toBe('COVERAGE_BLOCKED')
    expect(published.json().error.details.target).toBe(missing)
  })

  it('C02 Bloom 6 chỉ trắc nghiệm: thiếu lý do 422, có lý do thì lưu coverage_ack', async () => {
    const auth = await session(personas.gvLan.subject)
    const requirement = await reqId('140110.0601a')
    const observable = await kcId('KC-TIN10-CAULENH')
    const created = await create(auth, courses.tin10.id, 'Bloom 6', [requirement])
    const payload = draft('Bloom 6', [requirement], [quiz('q', 'diagnostic', [choice('c1', [observable])])])
    expect((await save(auth, created.moduleId, 1, payload)).statusCode).toBe(200)
    const report = await app.inject({ method: 'POST', url: `/api/v1/modules/${created.moduleId}/draft/validate`, headers: headers(auth) })
    expect(report.json().warnings.some((warning: { code: string }) => warning.code === 'V02')).toBe(true)
    const blocked = await publish(auth, created.moduleId, 2, 'c02-key-0000001')
    expect(blocked.statusCode).toBe(422)
    expect(blocked.json().error.code).toBe('VALIDATION_FAILED')
    expect(blocked.json().error.details.missingAcknowledgements[0].code).toBe('V02')
    const reason = 'Chỉ luyện nhận biết ở vòng này'
    const published = await publish(auth, created.moduleId, 2, 'c02-key-0000002', [{ code: 'V02', target: requirement, reason }])
    expect(published.statusCode).toBe(201)
    const ack = await sql<{ coverage_ack: { reason: string }[] }>`SELECT coverage_ack FROM module_versions WHERE id = ${published.json().id}`.execute(adminDb)
    expect(ack.rows[0]?.coverage_ack[0]?.reason).toBe(reason)
  })

  it('C07 câu ai_proposal chưa approved_by bị V07', async () => {
    const auth = await session(personas.gvLan.subject)
    const requirement = await reqId('140110.0101a')
    const observable = await kcId('KC-TIN10-RENHANH')
    const created = await create(auth, courses.tin10.id, 'AI', [requirement])
    const payload = draft('AI', [requirement], [quiz('q', 'diagnostic', [choice('c1', [observable])])])
    expect((await save(auth, created.moduleId, 1, payload)).statusCode).toBe(200)
    await sql`
      UPDATE module_drafts
      SET payload = jsonb_set(payload #- '{items,0,assessment,questions,0,approvedBy}', '{items,0,assessment,questions,0,source}', '"ai_proposal"')
      WHERE module_id = ${created.moduleId}
    `.execute(adminDb)
    const report = await app.inject({ method: 'POST', url: `/api/v1/modules/${created.moduleId}/draft/validate`, headers: headers(auth) })
    expect(report.json().warnings.some((warning: { code: string }) => warning.code === 'V07')).toBe(true)
    const published = await publish(auth, created.moduleId, 2, 'c07-key-0000001')
    expect(published.statusCode).toBe(422)
    expect(published.json().error.code).toBe('COVERAGE_BLOCKED')
  })

  it('V05-PREREQ diagnostic được quan sát tiên quyết trực tiếp, practice thì không', async () => {
    const auth = await session(personas.gvHung.subject)
    const requirement = await reqId('020107.0101a')
    const inScope = await kcId('KC-TOAN7-PHANSO')
    const prereq = await kcId('KC-TOAN6-PHANSO')
    const created = await create(auth, courses.toan7.id, 'Phân số', [requirement])
    const diagnostic = draft('Phân số', [requirement], [quiz('q', 'diagnostic', [choice('c1', [inScope, prereq])])])
    expect((await save(auth, created.moduleId, 1, diagnostic)).statusCode).toBe(200)
    const allowed = await app.inject({ method: 'POST', url: `/api/v1/modules/${created.moduleId}/draft/validate`, headers: headers(auth) })
    expect(allowed.json().warnings.some((warning: { code: string }) => warning.code === 'V05')).toBe(false)
    const practice = draft('Phân số', [requirement], [quiz('q', 'practice', [choice('c1', [inScope, prereq])])])
    expect((await save(auth, created.moduleId, 2, practice)).statusCode).toBe(200)
    const blocked = await app.inject({ method: 'POST', url: `/api/v1/modules/${created.moduleId}/draft/validate`, headers: headers(auth) })
    expect(blocked.json().warnings.some((warning: { code: string }) => warning.code === 'V05')).toBe(true)
  })

  it('V05-SUPERSEDED báo V05 kèm version thay thế', async () => {
    const auth = await session(personas.gvLan.subject)
    const requirement = await reqId('140110.0101a')
    const observable = await kcId('KC-TIN10-RENHANH')
    const created = await create(auth, courses.tin10.id, 'Version KC', [requirement])
    const payload = draft('Version KC', [requirement], [quiz('q', 'diagnostic', [choice('c1', [observable])])])
    expect((await save(auth, created.moduleId, 1, payload)).statusCode).toBe(200)
    const inserted = await sql<{ id: string; version_no: number }>`
      INSERT INTO kc_versions (kc_id, version_no, name, description, observable_criteria, status, source, created_by, reviewed_by, reviewed_at)
      SELECT kc_id, version_no + 1, name, description, observable_criteria, 'approved', source, created_by, reviewed_by, now()
      FROM kc_versions WHERE id = ${observable}
      RETURNING id, version_no
    `.execute(adminDb)
    await sql`UPDATE kc_versions SET status = 'superseded' WHERE id = ${observable}`.execute(adminDb)
    const report = await app.inject({ method: 'POST', url: `/api/v1/modules/${created.moduleId}/draft/validate`, headers: headers(auth) })
    const warning = (report.json().warnings as { code: string; replacementVersionId?: string }[]).find((item) => item.code === 'V05')
    expect(warning?.replacementVersionId).toBe(inserted.rows[0]?.id)
    expect(report.json().superseded[0].replacementVersionNo).toBe(inserted.rows[0]?.version_no)
  })

  it('IDEMP-PUBLISH cùng key trả cùng version, khác body thì 409', async () => {
    const auth = await session(personas.gvLan.subject)
    const requirement = await reqId('140110.0101a')
    const observable = await kcId('KC-TIN10-RENHANH')
    const created = await create(auth, courses.tin10.id, 'Idem', [requirement])
    const payload = draft('Idem', [requirement], [quiz('q', 'diagnostic', [choice('c1', [observable])])])
    expect((await save(auth, created.moduleId, 1, payload)).statusCode).toBe(200)
    const ack = [{ code: 'V08', target: 'không-có', reason: 'lý do giữ lại' }]
    const first = await publish(auth, created.moduleId, 2, 'idem-key-000001', ack)
    expect(first.statusCode).toBe(201)
    const again = await publish(auth, created.moduleId, 2, 'idem-key-000001', ack)
    expect(again.statusCode).toBe(201)
    expect(again.json().id).toBe(first.json().id)
    const reused = await publish(auth, created.moduleId, 2, 'idem-key-000001', [{ code: 'V08', target: 'khác', reason: 'lý do khác hẳn' }])
    expect(reused.statusCode).toBe(409)
    expect(reused.json().error.code).toBe('IDEMPOTENCY_KEY_REUSED')
    const duplicate = await publish(auth, created.moduleId, 2, 'idem-key-000002', ack)
    expect(duplicate.statusCode).toBe(409)
    expect(duplicate.json().error.code).toBe('ALREADY_PUBLISHED')
  })

  it('xem trước không chứa answerKey rationale optionMisconceptions kcRequired hay chuỗi đáp án', async () => {
    const auth = await session(personas.gvLan.subject)
    const requirement = await reqId('140110.0101a')
    const observable = await kcId('KC-TIN10-RENHANH')
    const mistake = await misconceptionId('M-TIN10-RENHANH')
    const created = await create(auth, courses.tin10.id, 'Xem trước', [requirement])
    const payload = draft('Xem trước', [requirement], [quiz('q', 'diagnostic', [{
      clientKey: 'c1',
      qtype: 'short_text',
      stem: rich('Em viết câu lệnh'),
      answerKey: { accept: ['zq-sentinel-7781'], caseSensitive: true },
      rationale: rich('zq-sentinel-7781'),
      kcRequired: [observable],
      kcObservable: [observable],
      bloomTarget: 2,
      optionMisconceptions: { b: mistake },
    }])])
    expect((await save(auth, created.moduleId, 1, payload)).statusCode).toBe(200)
    const preview = await app.inject({ method: 'GET', url: `/api/v1/modules/${created.moduleId}/draft/preview`, headers: headers(auth) })
    expect(preview.statusCode).toBe(200)
    const text = preview.body
    expect(text).not.toContain('answerKey')
    expect(text).not.toContain('rationale')
    expect(text).not.toContain('optionMisconceptions')
    expect(text).not.toContain('kcRequired')
    expect(text).not.toContain('zq-sentinel-7781')
    expect(text).toContain('Em viết câu lệnh')
  })

  it('client gửi source thì 422', async () => {
    const auth = await session(personas.gvLan.subject)
    const created = await create(auth, courses.tin10.id, 'Cấm source', [])
    const payload = draft('Cấm source', [], [quiz('q', 'diagnostic', [{ ...choice('c1', ['00000000-0000-4000-8000-000000000099']), source: 'teacher' }])])
    const saved = await save(auth, created.moduleId, 1, payload)
    expect(saved.statusCode).toBe(422)
  })
})
