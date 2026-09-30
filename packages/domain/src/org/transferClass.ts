import { sql } from 'kysely'
import { DomainError } from '../errors.ts'
import { audit, outbox, pgCode, requireOrg, sameSchool, type Db, type Meta } from './support.ts'

export async function transferClass(
  db: Db,
  meta: Meta,
  input: { learnerId: string; toClassId: string; onDate: string },
): Promise<{ learnerId: string; toClassId: string; status: 'transferred' }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.onDate)) throw new DomainError('VALIDATION_FAILED')
  const target = await db
    .selectFrom('admin_classes')
    .select(['id', 'school_id', 'academic_year_id'])
    .where('id', '=', input.toClassId)
    .executeTakeFirst()
  sameSchool(target?.school_id, meta.actor.schoolId)
  requireOrg(meta.actor)
  const learner = await db
    .selectFrom('school_memberships')
    .select(['user_id'])
    .where('school_id', '=', meta.actor.schoolId)
    .where('user_id', '=', input.learnerId)
    .where('role', '=', 'student')
    .where('status', '=', 'active')
    .executeTakeFirst()
  if (!learner || !target) throw new DomainError('NOT_FOUND')
  try {
    await db.transaction().execute(async (trx) => {
      const current = await sql<{ id: string; class_id: string; start: string | null; end: string | null }>`
        SELECT id, class_id, lower(valid)::text AS start, upper(valid)::text AS end
        FROM class_memberships
        WHERE learner_id = ${input.learnerId}
          AND school_id = ${meta.actor.schoolId}
          AND academic_year_id = ${target.academic_year_id}
          AND valid @> ${input.onDate}::date
        FOR UPDATE
      `.execute(trx)
      const row = current.rows[0]
      if (!row?.start) throw new DomainError('NOT_FOUND')
      if (row.class_id === input.toClassId) throw new DomainError('VALIDATION_FAILED')
      if (row.start >= input.onDate) throw new DomainError('VALIDATION_FAILED')
      await sql`
        UPDATE class_memberships
        SET valid = daterange(${row.start}::date, ${input.onDate}::date, '[)')
        WHERE id = ${row.id}
      `.execute(trx)
      await sql`
        INSERT INTO class_memberships (school_id, academic_year_id, class_id, learner_id, valid)
        VALUES (
          ${meta.actor.schoolId},
          ${target.academic_year_id},
          ${input.toClassId},
          ${input.learnerId},
          daterange(${input.onDate}::date, ${row.end}::date, '[)')
        )
      `.execute(trx)
      await audit(trx, meta, {
        action: 'class.transfer',
        objectType: 'class_membership',
        objectId: row.id,
        details: { learnerId: input.learnerId, toClassId: input.toClassId, status: 'transferred' },
      })
      await outbox(trx, {
        schoolId: meta.actor.schoolId,
        aggregateType: 'class_membership',
        aggregateId: row.id,
        eventType: 'ClassTransferred',
        payload: { learnerId: input.learnerId, toClassId: input.toClassId, status: 'transferred' },
      })
    })
  } catch (error) {
    if (error instanceof DomainError) throw error
    if (pgCode(error) === '23P01' || pgCode(error) === '23514') throw new DomainError('VALIDATION_FAILED')
    throw error
  }
  return { learnerId: input.learnerId, toClassId: input.toClassId, status: 'transferred' }
}
