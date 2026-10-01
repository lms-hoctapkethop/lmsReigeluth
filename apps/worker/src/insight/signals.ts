import { sql, type Transaction } from 'kysely'
import type { Database } from '@hcn/db'
import type { InsightEvent } from './derive.ts'

type Db = Transaction<Database>

export async function updateMisconceptionSignals(db: Db, event: InsightEvent): Promise<void> {
  const ids = (event.payload.responseIds ?? '').split(',').map((item) => item.trim()).filter((item) => /^\d+$/.test(item))
  if (ids.length === 0) return
  const seeds = await sql<{ learner_id: string; offering_id: string; misconception_id: string }>`
    SELECT DISTINCT qa.learner_id::text, mr.offering_id::text, r.misconception_id::text
      FROM question_responses r
      JOIN quiz_attempts qa ON qa.id = r.attempt_id
      JOIN module_releases mr ON mr.id = qa.module_release_id
     WHERE r.misconception_id IS NOT NULL
       AND r.id = ANY(${sql.raw(`ARRAY[${ids.map((id) => `${Number(id)}`).join(',')}]::bigint[]`)})
  `.execute(db)
  for (const seed of seeds.rows) {
    const evidence = await sql<{ id: string; question_item_id: string }>`
      SELECT r.id::text, r.question_item_id::text
        FROM question_responses r
        JOIN quiz_attempts qa ON qa.id = r.attempt_id
        JOIN module_releases mr ON mr.id = qa.module_release_id
       WHERE qa.learner_id = ${seed.learner_id}::uuid
         AND mr.offering_id = ${seed.offering_id}::uuid
         AND r.misconception_id = ${seed.misconception_id}::uuid
    `.execute(db)
    const responseIds = evidence.rows.map((row) => row.id)
    const distinct = new Set(evidence.rows.map((row) => row.question_item_id)).size
    if (distinct === 0) continue
    const status = distinct >= 2 ? 'signal' : 'seen_once'
    const idList = sql`ARRAY[${sql.join(responseIds.map((id) => sql`${id}::bigint`))}]`
    await sql`
      INSERT INTO misconception_signals (
        school_id, learner_id, offering_id, misconception_id, evidence_response_ids, distinct_items, status
      ) VALUES (
        ${event.school_id}::uuid, ${seed.learner_id}::uuid, ${seed.offering_id}::uuid, ${seed.misconception_id}::uuid,
        ${idList}, ${distinct}, ${status}
      )
      ON CONFLICT (learner_id, offering_id, misconception_id) DO UPDATE
      SET evidence_response_ids = EXCLUDED.evidence_response_ids,
          distinct_items = EXCLUDED.distinct_items,
          status = CASE
            WHEN misconception_signals.status = 'resolved' THEN misconception_signals.status
            ELSE EXCLUDED.status
          END,
          updated_at = now()
    `.execute(db)
  }
}
