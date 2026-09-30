import { randomUUID } from 'node:crypto'
import { DomainError } from '../errors.ts'
import { audit, outbox, requireOrg, sameSchool, type Db, type Meta } from './support.ts'

export async function enrollLearners(
  db: Db,
  meta: Meta,
  input: { offeringId: string; learnerIds: string[] },
): Promise<{
  enrolled: string[]
  alreadyEnrolled: string[]
  rejected: { learnerId: string; reason: string }[]
}> {
  const offering = await db.selectFrom('offerings').select(['id', 'school_id']).where('id', '=', input.offeringId).executeTakeFirst()
  sameSchool(offering?.school_id, meta.actor.schoolId)
  requireOrg(meta.actor)
  if (input.learnerIds.length === 0 || input.learnerIds.length > 500) throw new DomainError('VALIDATION_FAILED')
  const enrolled: string[] = []
  const alreadyEnrolled: string[] = []
  const rejected: { learnerId: string; reason: string }[] = []
  await db.transaction().execute(async (trx) => {
    for (const learnerId of input.learnerIds) {
      const student = await trx
        .selectFrom('school_memberships')
        .select(['user_id'])
        .where('school_id', '=', meta.actor.schoolId)
        .where('user_id', '=', learnerId)
        .where('role', '=', 'student')
        .where('status', '=', 'active')
        .executeTakeFirst()
      if (!student) {
        rejected.push({ learnerId, reason: 'NOT_STUDENT' })
        continue
      }
      const existing = await trx
        .selectFrom('offering_enrollments')
        .select(['id', 'status'])
        .where('offering_id', '=', input.offeringId)
        .where('learner_id', '=', learnerId)
        .executeTakeFirst()
      if (existing?.status === 'active') {
        alreadyEnrolled.push(learnerId)
        continue
      }
      if (existing?.status === 'withdrawn') {
        await trx
          .updateTable('offering_enrollments')
          .set({ status: 'active', withdrawn_at: null })
          .where('id', '=', existing.id)
          .execute()
        await audit(trx, meta, {
          action: 'enrollment.reopen',
          objectType: 'offering_enrollment',
          objectId: existing.id,
          details: { id: existing.id, offeringId: input.offeringId, learnerId, status: 'active' },
        })
        enrolled.push(learnerId)
        continue
      }
      const id = randomUUID()
      await trx
        .insertInto('offering_enrollments')
        .values({
          id,
          school_id: meta.actor.schoolId,
          offering_id: input.offeringId,
          learner_id: learnerId,
          status: 'active',
          withdrawn_at: null,
        })
        .execute()
      await audit(trx, meta, {
        action: 'enrollment.enroll',
        objectType: 'offering_enrollment',
        objectId: id,
        details: { id, offeringId: input.offeringId, learnerId, status: 'active' },
      })
      enrolled.push(learnerId)
    }
    await outbox(trx, {
      schoolId: meta.actor.schoolId,
      aggregateType: 'offering',
      aggregateId: input.offeringId,
      eventType: 'LearnersEnrolled',
      payload: { offeringId: input.offeringId, enrolled: enrolled.join(','), status: 'active' },
    })
  })
  return { enrolled, alreadyEnrolled, rejected }
}
