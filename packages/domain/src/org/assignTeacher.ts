import { randomUUID } from 'node:crypto'
import { sql } from 'kysely'
import { DomainError } from '../errors.ts'
import { audit, outbox, pgCode, requireOrg, sameSchool, type Db, type Meta } from './support.ts'

const allowed = new Set(['teach', 'author', 'release', 'review', 'view'])

export async function assignTeacher(
  db: Db,
  meta: Meta,
  input: { offeringId: string; teacherId: string; capabilities?: string[] },
): Promise<{ id: string; offeringId: string; teacherId: string; capabilities: string[] }> {
  const offering = await db.selectFrom('offerings').select(['id', 'school_id']).where('id', '=', input.offeringId).executeTakeFirst()
  sameSchool(offering?.school_id, meta.actor.schoolId)
  requireOrg(meta.actor)
  const capabilities = input.capabilities && input.capabilities.length > 0 ? input.capabilities : ['teach', 'author', 'release', 'review']
  if (capabilities.some((item) => !allowed.has(item))) throw new DomainError('VALIDATION_FAILED')
  const teacher = await db
    .selectFrom('school_memberships')
    .select(['user_id'])
    .where('school_id', '=', meta.actor.schoolId)
    .where('user_id', '=', input.teacherId)
    .where('role', '=', 'teacher')
    .where('status', '=', 'active')
    .executeTakeFirst()
  if (!teacher) throw new DomainError('VALIDATION_FAILED')
  const id = randomUUID()
  const at = meta.clock.now().toISOString()
  try {
    await db.transaction().execute(async (trx) => {
      await trx
        .insertInto('teacher_assignments')
        .values({
          id,
          school_id: meta.actor.schoolId,
          offering_id: input.offeringId,
          teacher_id: input.teacherId,
          capabilities,
          valid: sql<string>`tstzrange(${at}::timestamptz, NULL, '[)')`,
          granted_by: meta.actor.userId,
        })
        .execute()
      await audit(trx, meta, {
        action: 'teacher.assign',
        objectType: 'teacher_assignment',
        objectId: id,
        details: { id, offeringId: input.offeringId, teacherId: input.teacherId, status: 'assigned' },
      })
      await outbox(trx, {
        schoolId: meta.actor.schoolId,
        aggregateType: 'teacher_assignment',
        aggregateId: id,
        eventType: 'TeacherAssigned',
        payload: { assignmentId: id, offeringId: input.offeringId, teacherId: input.teacherId, status: 'assigned' },
      })
    })
  } catch (error) {
    if (pgCode(error) === '23P01') throw new DomainError('ASSIGNMENT_OVERLAP')
    throw error
  }
  return { id, offeringId: input.offeringId, teacherId: input.teacherId, capabilities }
}
