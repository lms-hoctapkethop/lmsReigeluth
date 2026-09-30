import { DomainError } from '../errors.ts'
import { audit, outbox, requireOrg, sameSchool, type Db, type Meta } from './support.ts'

export async function withdrawEnrollment(
  db: Db,
  meta: Meta,
  input: { offeringId: string; learnerId: string },
): Promise<{ learnerId: string; status: 'withdrawn' }> {
  const offering = await db.selectFrom('offerings').select(['id', 'school_id']).where('id', '=', input.offeringId).executeTakeFirst()
  sameSchool(offering?.school_id, meta.actor.schoolId)
  requireOrg(meta.actor)
  const row = await db
    .selectFrom('offering_enrollments')
    .select(['id', 'status', 'school_id'])
    .where('offering_id', '=', input.offeringId)
    .where('learner_id', '=', input.learnerId)
    .executeTakeFirst()
  sameSchool(row?.school_id, meta.actor.schoolId)
  if (row?.status !== 'active') throw new DomainError('VALIDATION_FAILED')
  const at = meta.clock.now()
  await db.transaction().execute(async (trx) => {
    await trx.updateTable('offering_enrollments').set({ status: 'withdrawn', withdrawn_at: at }).where('id', '=', row.id).execute()
    await audit(trx, meta, {
      action: 'enrollment.withdraw',
      objectType: 'offering_enrollment',
      objectId: row.id,
      details: { id: row.id, offeringId: input.offeringId, learnerId: input.learnerId, status: 'withdrawn' },
    })
    await outbox(trx, {
      schoolId: meta.actor.schoolId,
      aggregateType: 'offering_enrollment',
      aggregateId: row.id,
      eventType: 'EnrollmentWithdrawn',
      payload: { enrollmentId: row.id, offeringId: input.offeringId, learnerId: input.learnerId, status: 'withdrawn' },
    })
  })
  return { learnerId: input.learnerId, status: 'withdrawn' }
}
