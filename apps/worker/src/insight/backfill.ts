import { sql, type Kysely } from 'kysely'
import type { Database } from '@hcn/db'
import { R0_MODEL_VERSION } from '@hcn/domain'
import { deriveObservations, type InsightEvent } from './derive.ts'
import { recomputeAll } from './recompute.ts'

type ResponseRef = { id: string; school_id: string; learner_id: string; offering_id: string; purpose: string }

export async function backfillInsights(db: Kysely<Database>): Promise<{ observations: number; estimates: number }> {
  const before = await sql<{ n: string }>`SELECT count(*)::text AS n FROM observations`.execute(db)
  const responses = await sql<ResponseRef>`
    SELECT r.id::text, r.school_id::text, qa.learner_id::text, mr.offering_id::text, a.purpose
      FROM question_responses r
      JOIN quiz_attempts qa ON qa.id = r.attempt_id
      JOIN assessment_versions a ON a.id = qa.assessment_version_id
      JOIN module_releases mr ON mr.id = qa.module_release_id
     WHERE qa.status = 'submitted' OR a.purpose = 'practice'
  `.execute(db)
  const groups = new Map<string, { schoolId: string; ids: string[] }>()
  const latest = new Map<string, { id: string; tryNo: number }>()
  const meta = await sql<{ id: string; question_item_id: string; try_no: number; purpose: string; attempt_id: string }>`
    SELECT r.id::text, r.question_item_id::text, r.try_no, a.purpose, r.attempt_id::text
      FROM question_responses r
      JOIN quiz_attempts qa ON qa.id = r.attempt_id
      JOIN assessment_versions a ON a.id = qa.assessment_version_id
     WHERE qa.status = 'submitted' OR a.purpose = 'practice'
  `.execute(db)
  for (const row of meta.rows) {
    if (row.purpose === 'practice') continue
    const key = `${row.attempt_id}:${row.question_item_id}`
    const current = latest.get(key)
    if (!current || row.try_no >= current.tryNo) latest.set(key, { id: row.id, tryNo: row.try_no })
  }
  const keep = new Set([...latest.values()].map((row) => row.id))
  for (const row of responses.rows) {
    if (row.purpose !== 'practice' && !keep.has(row.id)) continue
    const key = `${row.school_id}:${row.learner_id}:${row.offering_id}`
    const group = groups.get(key) ?? { schoolId: row.school_id, ids: [] }
    group.ids.push(row.id)
    groups.set(key, group)
  }
  for (const group of groups.values()) {
    const event: InsightEvent = {
      event_id: '00000000-0000-4000-8000-000000000000',
      event_type: 'QuestionAnswered',
      school_id: group.schoolId,
      payload: { responseIds: group.ids.join(',') },
    }
    await db.transaction().execute((trx) => deriveObservations(trx, event))
  }
  const reviews = await sql<{ id: string; school_id: string }>`
    SELECT id::text, school_id::text FROM reviews WHERE status = 'published'
  `.execute(db)
  for (const review of reviews.rows) {
    const event: InsightEvent = {
      event_id: '00000000-0000-4000-8000-000000000000',
      event_type: 'ReviewPublished',
      school_id: review.school_id,
      payload: { reviewId: review.id },
    }
    await db.transaction().execute((trx) => deriveObservations(trx, event))
  }
  const estimates = await recomputeAll(db, R0_MODEL_VERSION)
  const after = await sql<{ n: string }>`SELECT count(*)::text AS n FROM observations`.execute(db)
  return { observations: Number(after.rows[0]?.n ?? 0) - Number(before.rows[0]?.n ?? 0), estimates }
}
