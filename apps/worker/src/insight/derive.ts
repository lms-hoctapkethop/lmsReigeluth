import { sql, type Transaction } from 'kysely'
import type { Database } from '@hcn/db'
import { observationFromCriterion, observationFromResponse } from '@hcn/domain'

type Db = Transaction<Database>

export type InsightEvent = {
  event_id: string
  event_type: string
  payload: Record<string, string>
  school_id: string
}

type ResponseRow = {
  id: string
  correct: boolean | null
  points: string | null
  hints_used: number
  try_no: number
  answered_at: Date
  provisional: boolean
  purpose: string
  learner_id: string
  offering_id: string
  kc_version_id: string
}

function scoreOf(points: string | null, correct: boolean | null): { correct: boolean | null; score: number } {
  if (points !== null) return { correct: correct ?? Number(points) === 1, score: Number(points) }
  if (correct === true) return { correct: true, score: 1 }
  if (correct === false) return { correct: false, score: 0 }
  return { correct: null, score: 0 }
}

async function insertObservation(
  db: Db,
  row: {
    schoolId: string
    learnerId: string
    offeringId: string
    kcVersionId: string
    sourceType: string
    sourceRef: string
    weight: number
    score: number
    hintsUsed: number
    provisional: boolean
    observedAt: Date
  },
): Promise<boolean> {
  const inserted = await sql<{ id: string }>`
    INSERT INTO observations (
      school_id, learner_id, offering_id, kc_version_id, source_type, source_ref,
      weight, score, hints_used, provisional_item, observed_at
    ) VALUES (
      ${row.schoolId}::uuid, ${row.learnerId}::uuid, ${row.offeringId}::uuid, ${row.kcVersionId}::uuid,
      ${row.sourceType}, ${row.sourceRef}, ${row.weight}, ${row.score}, ${row.hintsUsed},
      ${row.provisional}, ${row.observedAt}
    )
    ON CONFLICT (source_ref, kc_version_id) DO NOTHING
    RETURNING id::text
  `.execute(db)
  return inserted.rows.length > 0
}

async function emitAdded(db: Db, schoolId: string, learnerId: string, offeringId: string, kcIds: string[]): Promise<void> {
  const unique = [...new Set(kcIds)]
  if (unique.length === 0) return
  await db
    .insertInto('outbox_events')
    .values({
      school_id: schoolId,
      aggregate_type: 'learner',
      aggregate_id: learnerId,
      event_type: 'ObservationsAdded',
      payload: { learnerId, offeringId, kcIds: unique.join(',') },
    })
    .execute()
}

export async function deriveObservations(db: Db, event: InsightEvent): Promise<void> {
  if (event.event_type === 'QuestionAnswered') await deriveResponses(db, event)
  else if (event.event_type === 'ReviewPublished') await deriveReview(db, event)
}

async function deriveResponses(db: Db, event: InsightEvent): Promise<void> {
  const ids = (event.payload.responseIds ?? '').split(',').map((item) => item.trim()).filter((item) => /^\d+$/.test(item))
  if (ids.length === 0) return
  const rows = await sql<ResponseRow>`
    SELECT r.id::text, r.correct, r.points::text, r.hints_used, r.try_no, r.answered_at,
           q.provisional, a.purpose, qa.learner_id::text, mr.offering_id::text, l.kc_version_id::text
      FROM question_responses r
      JOIN question_items q ON q.id = r.question_item_id
      JOIN quiz_attempts qa ON qa.id = r.attempt_id
      JOIN assessment_versions a ON a.id = qa.assessment_version_id
      JOIN module_releases mr ON mr.id = qa.module_release_id
      JOIN question_kc_links l ON l.question_item_id = r.question_item_id AND l.role = 'observable'
     WHERE r.id = ANY(${sql.raw(`ARRAY[${ids.map((id) => `${Number(id)}`).join(',')}]::bigint[]`)})
  `.execute(db)
  const added = new Map<string, { learnerId: string; offeringId: string; kcIds: string[] }>()
  for (const row of rows.rows) {
    const graded = scoreOf(row.points, row.correct)
    const observed = observationFromResponse({
      purpose: row.purpose,
      tryNo: row.try_no,
      hintsUsed: row.hints_used,
      correct: graded.correct,
      score: graded.score,
      provisionalItem: row.provisional,
    })
    if (!observed) continue
    const kc = await sql<{ kc_id: string }>`SELECT kc_id::text FROM kc_versions WHERE id = ${row.kc_version_id}::uuid`.execute(db)
    const kcId = kc.rows[0]?.kc_id
    if (!kcId) continue
    const wrote = await insertObservation(db, {
      schoolId: event.school_id,
      learnerId: row.learner_id,
      offeringId: row.offering_id,
      kcVersionId: row.kc_version_id,
      sourceType: row.purpose,
      sourceRef: `response:${row.id}`,
      weight: observed.weight,
      score: observed.score,
      hintsUsed: row.hints_used,
      provisional: row.provisional,
      observedAt: row.answered_at,
    })
    if (!wrote) continue
    const key = `${row.learner_id}:${row.offering_id}`
    const group = added.get(key) ?? { learnerId: row.learner_id, offeringId: row.offering_id, kcIds: [] }
    group.kcIds.push(kcId)
    added.set(key, group)
  }
  for (const group of added.values()) await emitAdded(db, event.school_id, group.learnerId, group.offeringId, group.kcIds)
}

async function deriveReview(db: Db, event: InsightEvent): Promise<void> {
  const reviewId = event.payload.reviewId
  if (!reviewId) return
  const rows = await sql<{
    criterion_id: string
    level: string
    kc_version_id: string | null
    published_at: Date
    learner_id: string
    offering_id: string
  }>`
    SELECT rc.id::text AS criterion_id, rcr.level, rc.kc_version_id::text, rev.published_at,
           sub.learner_id::text, mr.offering_id::text
      FROM review_criterion_results rcr
      JOIN rubric_criteria rc ON rc.id = rcr.rubric_criterion_id
      JOIN reviews rev ON rev.id = rcr.review_id
      JOIN submissions sub ON sub.id = rev.submission_id
      JOIN module_releases mr ON mr.id = sub.module_release_id
     WHERE rev.id = ${reviewId}::uuid AND rev.status = 'published'
  `.execute(db)
  const added = new Map<string, { learnerId: string; offeringId: string; kcIds: string[] }>()
  for (const row of rows.rows) {
    const observed = observationFromCriterion(row.level, row.kc_version_id)
    if (!observed || !row.kc_version_id || !row.published_at) continue
    const kc = await sql<{ kc_id: string }>`SELECT kc_id::text FROM kc_versions WHERE id = ${row.kc_version_id}::uuid`.execute(db)
    const kcId = kc.rows[0]?.kc_id
    if (!kcId) continue
    const wrote = await insertObservation(db, {
      schoolId: event.school_id,
      learnerId: row.learner_id,
      offeringId: row.offering_id,
      kcVersionId: row.kc_version_id,
      sourceType: 'review',
      sourceRef: `review_criterion:${reviewId}:${row.criterion_id}`,
      weight: observed.weight,
      score: observed.score,
      hintsUsed: 0,
      provisional: false,
      observedAt: row.published_at,
    })
    if (!wrote) continue
    const key = `${row.learner_id}:${row.offering_id}`
    const group = added.get(key) ?? { learnerId: row.learner_id, offeringId: row.offering_id, kcIds: [] }
    group.kcIds.push(kcId)
    added.set(key, group)
  }
  for (const group of added.values()) await emitAdded(db, event.school_id, group.learnerId, group.offeringId, group.kcIds)
}
