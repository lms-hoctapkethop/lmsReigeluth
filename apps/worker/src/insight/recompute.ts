import { sql, type Kysely, type Transaction } from 'kysely'
import type { Database } from '@hcn/db'
import { R0_MODEL_VERSION, r0Estimate, type R0Observation } from '@hcn/domain'
import type { InsightEvent } from './derive.ts'

type Db = Kysely<Database> | Transaction<Database>

type Group = { schoolId: string; learnerId: string; offeringId: string; kcId: string }

function sameValue(stored: string | null, next: number | null): boolean {
  if (stored === null || next === null) return stored === null && next === null
  return Number(stored) === next
}

async function recomputeOne(db: Db, group: Group, modelVersion: string): Promise<boolean> {
  const approved = await sql<{ id: string }>`
    SELECT id::text FROM kc_versions
     WHERE kc_id = ${group.kcId}::uuid AND status = 'approved'
     ORDER BY version_no DESC
     LIMIT 1
  `.execute(db)
  const versionId = approved.rows[0]?.id
  if (!versionId) return false
  const observations = await sql<{
    id: string
    source_type: R0Observation['sourceType']
    weight: string
    score: string
    hints_used: number
    observed_at: Date
  }>`
    SELECT o.id::text, o.source_type, o.weight::text, o.score::text, o.hints_used, o.observed_at
      FROM observations o
      JOIN kc_versions v ON v.id = o.kc_version_id
     WHERE o.learner_id = ${group.learnerId}::uuid
       AND o.offering_id = ${group.offeringId}::uuid
       AND v.kc_id = ${group.kcId}::uuid
  `.execute(db)
  const input: R0Observation[] = observations.rows.map((row) => ({
    sourceType: row.source_type,
    weight: Number(row.weight),
    score: Number(row.score),
    hintsUsed: row.hints_used,
    observedAt: row.observed_at.toISOString(),
  }))
  const estimate = r0Estimate(input)
  const current = await sql<{ status: string; value: string | null }>`
    SELECT status, value::text FROM needs_current_kc
     WHERE learner_id = ${group.learnerId}::uuid
       AND offering_id = ${group.offeringId}::uuid
       AND kc_id = ${group.kcId}::uuid
       AND model_version = ${modelVersion}
  `.execute(db)
  const latest = current.rows[0]
  if (latest && latest.status === estimate.status && sameValue(latest.value, estimate.value)) return false
  const ids = observations.rows.map((row) => row.id)
  const idList = ids.length === 0 ? sql`ARRAY[]::bigint[]` : sql`ARRAY[${sql.join(ids.map((id) => sql`${id}::bigint`))}]`
  await sql`
    INSERT INTO needs_estimates (
      school_id, learner_id, offering_id, kc_version_id, status, value, n_observations, model_version, observation_ids
    ) VALUES (
      ${group.schoolId}::uuid, ${group.learnerId}::uuid, ${group.offeringId}::uuid, ${versionId}::uuid,
      ${estimate.status}, ${estimate.value}, ${estimate.n}, ${modelVersion}, ${idList}
    )
  `.execute(db)
  return true
}

export async function recomputeNeeds(db: Db, event: InsightEvent, modelVersion = R0_MODEL_VERSION): Promise<void> {
  const learnerId = event.payload.learnerId
  const offeringId = event.payload.offeringId
  const kcIds = (event.payload.kcIds ?? '').split(',').map((item) => item.trim()).filter(Boolean)
  if (!learnerId || !offeringId || kcIds.length === 0) return
  for (const kcId of kcIds) {
    await recomputeOne(db, { schoolId: event.school_id, learnerId, offeringId, kcId }, modelVersion)
  }
}

export async function recomputeAll(db: Kysely<Database>, modelVersion: string): Promise<number> {
  const groups = await sql<{ school_id: string; learner_id: string; offering_id: string; kc_id: string }>`
    SELECT DISTINCT o.school_id::text, o.learner_id::text, o.offering_id::text, v.kc_id::text
      FROM observations o
      JOIN kc_versions v ON v.id = o.kc_version_id
  `.execute(db)
  let inserted = 0
  for (const row of groups.rows) {
    const wrote = await db.transaction().execute((trx) =>
      recomputeOne(trx, { schoolId: row.school_id, learnerId: row.learner_id, offeringId: row.offering_id, kcId: row.kc_id }, modelVersion),
    )
    if (wrote) inserted += 1
  }
  return inserted
}
