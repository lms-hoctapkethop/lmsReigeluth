import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { sql } from 'kysely'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb, effectivePrerequisites, type Database } from '@hcn/db'
import type { Kysely } from 'kysely'
import { personas, seedIdentity } from '@hcn/testkit/identity'
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
if (process.env.CI === 'true' && !ready) throw new Error('Job CI cần Docker và dbmate để chạy chương trình')

const appOrigin = 'http://127.0.0.1:4319'
const issuer = 'http://idp.test/realms/hcn'

describe.skipIf(!ready)('chương trình M3', () => {
  let postgres: Postgres18
  let adminDb: Kysely<Database>
  let db: Kysely<Database>
  let app: FastifyInstance

  beforeAll(async () => {
    postgres = await startPostgres18()
    const cloned = await postgres.cloneDatabase('curriculum_api')
    adminDb = createDb(cloned.url)
    db = createDb(cloned.appUrl)
    const config: AppConfig = {
      appOrigin,
      databaseUrl: cloned.appUrl,
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
      TRUNCATE curriculum_review_log, requirement_kc_links, kc_edges, misconceptions, kc_versions,
        knowledge_components, curriculum_requirements, curriculum_reviewers, sessions, audit_log
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

  async function session(userId: string, role: string): Promise<{ cookie: string; csrf: string }> {
    const token = randomUUID()
    const csrf = randomUUID()
    const hash = createHash('sha256').update(token).digest('hex')
    await sql`
      INSERT INTO sessions (id_hash, user_id, csrf_token, context, created_at, last_seen_at, expires_at)
      VALUES (${hash}, ${userId}, ${csrf}, ${JSON.stringify({ school_id: '20000000-0000-4000-8000-000000000001', role })}::jsonb, now(), now(), now() + interval '2 hours')
    `.execute(db)
    return { cookie: `hcn_sid=${token}`, csrf }
  }

  function headers(auth: { cookie: string; csrf: string }, extra: Record<string, string> = {}): Record<string, string> {
    return { cookie: auth.cookie, origin: appOrigin, 'x-csrf-token': auth.csrf, ...extra }
  }

  async function requirement(stem: string): Promise<{ id: string; revision: string }> {
    const row = await sql<{ id: string; revision: string }>`
      SELECT id, (extract(epoch from updated_at) * 1000000)::bigint::text AS revision
        FROM curriculum_requirements WHERE code791_stem = ${stem}
    `.execute(db)
    const found = row.rows[0]
    if (!found) throw new Error(stem)
    return found
  }

  async function kcVersion(code: string): Promise<{ kcId: string; versionId: string }> {
    const row = await sql<{ kc_id: string; id: string }>`
      SELECT v.kc_id, v.id FROM kc_versions v
        JOIN knowledge_components k ON k.id = v.kc_id
       WHERE k.code = ${code} AND v.version_no = 1
    `.execute(db)
    const found = row.rows[0]
    if (!found) throw new Error(code)
    return { kcId: found.kc_id, versionId: found.id }
  }

  it('DB04-API duyệt cạnh tạo vòng không ghi log hay audit', async () => {
    const beforeLog = await sql<{ n: number }>`SELECT count(*)::int AS n FROM curriculum_review_log`.execute(db)
    const beforeAudit = await sql<{ n: number }>`SELECT count(*)::int AS n FROM audit_log`.execute(db)
    const edge = await sql<{ id: string }>`
      SELECT id FROM kc_edges WHERE status = 'proposed'
        AND from_kc_version_id = (SELECT v.id FROM kc_versions v JOIN knowledge_components k ON k.id = v.kc_id WHERE k.code = 'KC-TIN10-RENHANH')
        AND to_kc_version_id = (SELECT v.id FROM kc_versions v JOIN knowledge_components k ON k.id = v.kc_id WHERE k.code = 'KC-TIN10-DIEUKIEN')
    `.execute(db)
    const auth = await session(personas.reviewerTin.subject, 'teacher')
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/curriculum/kc-edges/${edge.rows[0]?.id}/review`,
      headers: headers(auth),
      payload: { decision: 'approved' },
    })
    expect(response.statusCode).toBe(422)
    expect(response.json().error.code).toBe('KC_EDGE_CYCLE')
    expect(response.json().error.details.path).toContain('KC-TIN10-RENHANH')
    const afterLog = await sql<{ n: number }>`SELECT count(*)::int AS n FROM curriculum_review_log`.execute(db)
    const afterAudit = await sql<{ n: number }>`SELECT count(*)::int AS n FROM audit_log`.execute(db)
    expect(afterLog.rows[0]?.n).toBe(beforeLog.rows[0]?.n)
    expect(afterAudit.rows[0]?.n).toBe(beforeAudit.rows[0]?.n)
  })

  it('M3-VERSION chép cạnh và liên kết, bỏ một cạnh', async () => {
    const renhanh = await kcVersion('KC-TIN10-RENHANH')
    const proposer = await session(personas.gvDeXuat.subject, 'teacher')
    const proposed = await app.inject({
      method: 'POST',
      url: `/api/v1/curriculum/kcs/${renhanh.kcId}/versions`,
      headers: headers(proposer),
      payload: { name: 'Rẽ nhánh v2', observableCriteria: 'Chọn nhánh và nói được vì sao.' },
    })
    expect(proposed.statusCode).toBe(201)
    const versionId = proposed.json().id as string
    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/curriculum/kc-versions/${versionId}`,
      headers: headers(await session(personas.reviewerTin.subject, 'teacher')),
    })
    const drop = (detail.json().edges as { id: string; toCode: string }[]).find((edge) => edge.toCode === 'KC-TIN10-LAP')
    const reviewer = await session(personas.reviewerTin.subject, 'teacher')
    const reviewed = await app.inject({
      method: 'POST',
      url: `/api/v1/curriculum/kc-versions/${versionId}/review`,
      headers: headers(reviewer),
      payload: { decision: 'approved', dropEdgeIds: drop ? [drop.id] : [] },
    })
    expect(reviewed.statusCode).toBe(200)
    const versions = await sql<{ version_no: number; status: string }>`
      SELECT version_no, status FROM kc_versions WHERE kc_id = ${renhanh.kcId} ORDER BY version_no
    `.execute(db)
    expect(versions.rows).toEqual([
      { version_no: 1, status: 'superseded' },
      { version_no: 2, status: 'approved' },
    ])
    const edges = await sql<{ from_code: string; to_code: string }>`
      SELECT sf.code AS from_code, st.code AS to_code
        FROM effective_kc_edges e
        JOIN kc_versions vf ON vf.id = e.from_kc_version_id
        JOIN kc_versions vt ON vt.id = e.to_kc_version_id
        JOIN knowledge_components sf ON sf.id = vf.kc_id
        JOIN knowledge_components st ON st.id = vt.kc_id
       WHERE sf.code IN ('KC-TIN10-DIEUKIEN', 'KC-TIN10-RENHANH') OR st.code = 'KC-TIN10-RENHANH'
       ORDER BY from_code, to_code
    `.execute(db)
    expect(edges.rows).toEqual([{ from_code: 'KC-TIN10-DIEUKIEN', to_code: 'KC-TIN10-RENHANH' }])
    const links = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM requirement_kc_links WHERE kc_version_id = ${versionId} AND status = 'approved'
    `.execute(db)
    expect(links.rows[0]?.n).toBe(1)
  })

  it('M3-VERSION-CYCLE chép cạnh gây vòng thì v1 vẫn approved', async () => {
    const renhanh = await kcVersion('KC-TIN10-RENHANH')
    const dieuKien = await kcVersion('KC-TIN10-DIEUKIEN')
    const proposer = await session(personas.gvDeXuat.subject, 'teacher')
    const proposed = await app.inject({
      method: 'POST',
      url: `/api/v1/curriculum/kcs/${renhanh.kcId}/versions`,
      headers: headers(proposer),
      payload: { name: 'Rẽ nhánh vòng', observableCriteria: 'Tiêu chí mới.' },
    })
    const versionId = proposed.json().id as string
    await sql`
      INSERT INTO kc_edges (from_kc_version_id, to_kc_version_id, edge_type, status, source, reviewed_by)
      VALUES (${versionId}, ${dieuKien.versionId}, 'prerequisite', 'approved', 'expert', ${personas.reviewerTin.subject})
    `.execute(adminDb)
    const reviewer = await session(personas.reviewerTin.subject, 'teacher')
    const reviewed = await app.inject({
      method: 'POST',
      url: `/api/v1/curriculum/kc-versions/${versionId}/review`,
      headers: headers(reviewer),
      payload: { decision: 'approved' },
    })
    expect(reviewed.statusCode).toBe(422)
    expect(reviewed.json().error.code).toBe('KC_EDGE_CYCLE')
    const status = await sql<{ status: string }>`SELECT status FROM kc_versions WHERE id = ${renhanh.versionId}`.execute(db)
    expect(status.rows[0]?.status).toBe('approved')
  })

  it('M3-SELF người đề xuất tự duyệt', async () => {
    const req = await requirement('140110.0101a')
    const proposer = await session(personas.reviewerTin.subject, 'teacher')
    const proposed = await app.inject({
      method: 'POST',
      url: '/api/v1/curriculum/kcs',
      headers: headers(proposer),
      payload: {
        code: 'KC-TIN10-TU-DUYET',
        subjectCode: '1401',
        grade: 10,
        name: 'Tự duyệt',
        observableCriteria: 'Không được tự duyệt.',
        requirementIds: [req.id],
      },
    })
    expect(proposed.statusCode).toBe(201)
    const reviewed = await app.inject({
      method: 'POST',
      url: `/api/v1/curriculum/kc-versions/${proposed.json().id}/review`,
      headers: headers(proposer),
      payload: { decision: 'approved' },
    })
    expect(reviewed.statusCode).toBe(422)
    expect(reviewed.json().error.details.reason).toBe('SELF_REVIEW')
  })

  it('M3-SCOPE reviewer.tin không duyệt môn 0201 và cạnh hai môn', async () => {
    const toan = await kcVersion('KC-TOAN10-SO')
    const tin = await session(personas.reviewerTin.subject, 'teacher')
    const denied = await app.inject({
      method: 'POST',
      url: `/api/v1/curriculum/kc-versions/${toan.versionId}/review`,
      headers: headers(tin),
      payload: { decision: 'approved' },
    })
    expect(denied.statusCode).toBe(403)
    const edge = await sql<{ id: string }>`
      SELECT e.id FROM kc_edges e
        JOIN kc_versions dst ON dst.id = e.to_kc_version_id
        JOIN knowledge_components st ON st.id = dst.kc_id
       WHERE st.code = 'KC-TOAN10-SO' AND e.status = 'proposed'
    `.execute(db)
    const cross = await app.inject({
      method: 'POST',
      url: `/api/v1/curriculum/kc-edges/${edge.rows[0]?.id}/review`,
      headers: headers(tin),
      payload: { decision: 'approved' },
    })
    expect(cross.statusCode).toBe(403)
    await sql`
      INSERT INTO curriculum_reviewers (user_id, subject_code, granted_by)
      VALUES (${personas.reviewerTin.subject}, '0201', ${personas.adminA.subject})
    `.execute(adminDb)
    const allowed = await app.inject({
      method: 'POST',
      url: `/api/v1/curriculum/kc-edges/${edge.rows[0]?.id}/review`,
      headers: headers(await session(personas.reviewerTin.subject, 'teacher')),
      payload: { decision: 'approved' },
    })
    expect(allowed.statusCode).toBe(200)
  })

  it('M3-REQ đối chiếu, sửa văn bản, approved và If-Match', async () => {
    const row = await requirement('020107.0102a')
    const auth = await session(personas.reviewerToan.subject, 'teacher')
    const stale = await app.inject({
      method: 'POST',
      url: `/api/v1/curriculum/requirements/${row.id}/review`,
      headers: headers(auth, { 'if-match': '1' }),
      payload: { decision: 'source_checked', note: 'đã xem' },
    })
    expect(stale.statusCode).toBe(409)
    expect(stale.json().error.code).toBe('REVISION_CONFLICT')
    const missingNote = await app.inject({
      method: 'POST',
      url: `/api/v1/curriculum/requirements/${row.id}/review`,
      headers: headers(auth, { 'if-match': row.revision }),
      payload: { decision: 'source_checked' },
    })
    expect(missingNote.statusCode).toBe(422)
    const checked = await app.inject({
      method: 'POST',
      url: `/api/v1/curriculum/requirements/${row.id}/review`,
      headers: headers(auth, { 'if-match': row.revision }),
      payload: { decision: 'source_checked', note: 'Khớp phụ lục', correctedText: 'Văn bản đã sửa.' },
    })
    expect(checked.statusCode).toBe(200)
    const log = await sql<{ old_text: string; new_text: string }>`
      SELECT old_text, new_text FROM curriculum_review_log WHERE entity_id = ${row.id}
    `.execute(db)
    expect(log.rows[0]).toEqual({ old_text: 'Sử dụng được các tính chất của phân số.', new_text: 'Văn bản đã sửa.' })
    const approved = await app.inject({
      method: 'POST',
      url: `/api/v1/curriculum/requirements/${row.id}/review`,
      headers: headers(auth, { 'if-match': checked.json().revision }),
      payload: { decision: 'approved', note: 'duyệt' },
    })
    expect(approved.statusCode).toBe(200)
    const again = await app.inject({
      method: 'POST',
      url: `/api/v1/curriculum/requirements/${row.id}/review`,
      headers: headers(auth, { 'if-match': approved.json().revision }),
      payload: { decision: 'rejected', note: 'sửa tiếp' },
    })
    expect(again.statusCode).toBe(422)
  })

  it('M3-QUEUE hàng check đứng trước và học sinh bị từ chối', async () => {
    const reviewer = await session(personas.reviewerTin.subject, 'teacher')
    const queue = await app.inject({ method: 'GET', url: '/api/v1/curriculum/review-queue', headers: { cookie: reviewer.cookie } })
    expect(queue.statusCode).toBe(200)
    const items = queue.json().items as { extraction: string; code: string }[]
    expect(items[0]?.extraction).toBe('check')
    const cleanIndex = items.findIndex((item) => item.extraction === 'clean')
    const lastCheck = items.filter((item) => item.extraction === 'check').length - 1
    expect(cleanIndex).toBeGreaterThan(lastCheck)
    const student = await session(personas.hsMinh.subject, 'student')
    const denied = await app.inject({ method: 'GET', url: '/api/v1/curriculum/review-queue', headers: { cookie: student.cookie } })
    expect(denied.statusCode).toBe(403)
  })

  it('M3-VISIBILITY hs.minh chỉ thấy YCCĐ approved hoặc source_checked', async () => {
    const student = await session(personas.hsMinh.subject, 'student')
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/curriculum/requirements?subject=1401&grade=10',
      headers: { cookie: student.cookie },
    })
    expect(response.statusCode).toBe(200)
    const body = response.json() as { reviewStatus: string; code791Stem: string }[]
    expect(body.every((item) => item.reviewStatus === 'approved' || item.reviewStatus === 'source_checked')).toBe(true)
    expect(body.map((item) => item.code791Stem).sort()).toEqual(['140110.0101a', '140110.0200b'])
    expect(Object.keys(body[0] ?? {}).sort()).toEqual(
      ['code791Stem', 'extraction', 'grade', 'id', 'reviewStatus', 'revision', 'sourceDoc', 'sourceLocator', 'subjectCode', 'text'].sort(),
    )
  })

  it('B04 effectivePrerequisites không trả cạnh proposed', async () => {
    const renhanh = await kcVersion('KC-TIN10-RENHANH')
    const edges = await effectivePrerequisites(db, renhanh.versionId)
    expect(edges).toHaveLength(1)
    expect(edges[0]?.edgeType).toBe('prerequisite')
  })
})
