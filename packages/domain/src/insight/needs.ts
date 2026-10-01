import { sql } from 'kysely'
import { DomainError } from '../errors.ts'
import { authorize } from '../identity/policies.ts'
import { activeEnrollment, capabilities } from '../learning/gate.ts'
import type { Db, Meta } from '../org/support.ts'
import { R0_MODEL_VERSION } from './r0.ts'
import { needLabels, type NeedStatus } from './labels.ts'

export type NeedsItem = {
  kcVersionId: string
  kcName: string
  status: NeedStatus
  label: string
  value?: number | null
  nObservations?: number
  modelVersion?: string
  computedAt?: string
}

type Row = {
  kc_version_id: string
  kc_name: string
  status: NeedStatus
  value: string | null
  n_observations: number
  model_version: string
  computed_at: Date
}

async function verifiedLink(db: Db, meta: Meta, learnerId: string): Promise<boolean> {
  const link = await db
    .selectFrom('guardian_links')
    .select('id')
    .where('school_id', '=', meta.actor.schoolId)
    .where('guardian_id', '=', meta.actor.userId)
    .where('learner_id', '=', learnerId)
    .where('status', '=', 'verified')
    .executeTakeFirst()
  return Boolean(link)
}

export async function getLearnerNeeds(db: Db, meta: Meta, learnerId: string, offeringId: string): Promise<NeedsItem[]> {
  const offering = await db.selectFrom('offerings').select(['id', 'school_id']).where('id', '=', offeringId).executeTakeFirst()
  if (!offering || offering.school_id !== meta.actor.schoolId) throw new DomainError('NOT_FOUND')
  const role = meta.actor.roles[0]
  let teacher = false
  if (role === 'teacher') {
    const caps = await capabilities(db, meta, offeringId)
    if (caps.length === 0) throw new DomainError('NOT_FOUND')
    authorize(meta.actor, 'needs.read', { teacherAssigned: true })
    teacher = true
  } else if (role === 'student') {
    if (learnerId !== meta.actor.userId) throw new DomainError('NOT_FOUND')
    const enrolled = await activeEnrollment(db, meta, offeringId)
    if (!enrolled) throw new DomainError('NOT_FOUND')
    authorize(meta.actor, 'needs.read', { enrolled: true })
  } else if (role === 'guardian') {
    if (!(await verifiedLink(db, meta, learnerId))) throw new DomainError('NOT_FOUND')
    throw new DomainError('NOT_FOUND')
  } else throw new DomainError('NOT_FOUND')

  const rows = await sql<Row>`
    SELECT n.kc_version_id::text, v.name AS kc_name, n.status, n.value::text, n.n_observations,
           n.model_version, n.computed_at
      FROM needs_current_kc n
      JOIN kc_versions v ON v.id = n.kc_version_id
     WHERE n.learner_id = ${learnerId}::uuid
       AND n.offering_id = ${offeringId}::uuid
       AND n.model_version = ${R0_MODEL_VERSION}
     ORDER BY v.name
  `.execute(db)
  return rows.rows.map((row) => {
    const item: NeedsItem = {
      kcVersionId: row.kc_version_id,
      kcName: row.kc_name,
      status: row.status,
      label: needLabels[row.status],
    }
    if (!teacher) return item
    return {
      ...item,
      value: row.value === null ? null : Number(row.value),
      nObservations: row.n_observations,
      modelVersion: row.model_version,
      computedAt: row.computed_at.toISOString(),
    }
  })
}
