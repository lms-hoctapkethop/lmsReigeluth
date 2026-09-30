import { sql } from 'kysely'
import { DomainError } from '../errors.ts'
import { audit, outbox, requireOrg, sameSchool, type Db, type Meta } from './support.ts'

export async function endTeacherAssignment(db: Db, meta: Meta, input: { offeringId: string; assignmentId: string }): Promise<{ id: string; status: 'ended' }> {
  const offering = await db.selectFrom('offerings').select(['id', 'school_id']).where('id', '=', input.offeringId).executeTakeFirst()
  sameSchool(offering?.school_id, meta.actor.schoolId)
  const assignment = await db
    .selectFrom('teacher_assignments')
    .select(['id', 'school_id', 'offering_id'])
    .where('id', '=', input.assignmentId)
    .executeTakeFirst()
  sameSchool(assignment?.school_id, meta.actor.schoolId)
  if (assignment?.offering_id !== input.offeringId) throw new DomainError('NOT_FOUND')
  requireOrg(meta.actor)
  const at = meta.clock.now().toISOString()
  const open = await db
    .selectFrom('teacher_assignments')
    .select(['id'])
    .where('id', '=', input.assignmentId)
    .where(sql<boolean>`upper(valid) IS NULL OR upper(valid) > ${at}::timestamptz`)
    .executeTakeFirst()
  if (!open) throw new DomainError('VALIDATION_FAILED')
  await db.transaction().execute(async (trx) => {
    await sql`UPDATE teacher_assignments SET valid = tstzrange(lower(valid), ${at}::timestamptz, '[)') WHERE id = ${input.assignmentId}`.execute(trx)
    await audit(trx, meta, {
      action: 'teacher.end',
      objectType: 'teacher_assignment',
      objectId: input.assignmentId,
      details: { id: input.assignmentId, offeringId: input.offeringId, status: 'ended' },
    })
    await outbox(trx, {
      schoolId: meta.actor.schoolId,
      aggregateType: 'teacher_assignment',
      aggregateId: input.assignmentId,
      eventType: 'TeacherAssignmentEnded',
      payload: { assignmentId: input.assignmentId, offeringId: input.offeringId, status: 'ended' },
    })
  })
  return { id: input.assignmentId, status: 'ended' }
}
