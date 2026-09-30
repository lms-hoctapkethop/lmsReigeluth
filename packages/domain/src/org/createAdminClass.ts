import { randomUUID } from 'node:crypto'
import { sql } from 'kysely'
import { DomainError } from '../errors.ts'
import { audit, outbox, pgCode, requireOrg, sameSchool, type Db, type Meta } from './support.ts'

export async function createAdminClass(
  db: Db,
  meta: Meta,
  input: { academicYearId: string; grade: number; code: string },
): Promise<{ id: string; academicYearId: string; grade: number; code: string }> {
  const year = await db.selectFrom('academic_years').select(['id', 'school_id']).where('id', '=', input.academicYearId).executeTakeFirst()
  sameSchool(year?.school_id, meta.actor.schoolId)
  requireOrg(meta.actor)
  if (!Number.isInteger(input.grade) || input.grade < 1 || input.grade > 12 || input.code.trim().length === 0) {
    throw new DomainError('VALIDATION_FAILED')
  }
  const id = randomUUID()
  try {
    await db.transaction().execute(async (trx) => {
      await trx
        .insertInto('admin_classes')
        .values({
          id,
          school_id: meta.actor.schoolId,
          academic_year_id: input.academicYearId,
          grade: input.grade,
          code: input.code.trim(),
          homeroom_teacher_id: null,
        })
        .execute()
      await audit(trx, meta, {
        action: 'admin_class.create',
        objectType: 'admin_class',
        objectId: id,
        details: { id, academicYearId: input.academicYearId, status: 'created' },
      })
      await outbox(trx, {
        schoolId: meta.actor.schoolId,
        aggregateType: 'admin_class',
        aggregateId: id,
        eventType: 'AdminClassCreated',
        payload: { classId: id, academicYearId: input.academicYearId, status: 'created' },
      })
    })
  } catch (error) {
    if (pgCode(error) === '23505') throw new DomainError('REVISION_CONFLICT')
    throw error
  }
  return { id, academicYearId: input.academicYearId, grade: input.grade, code: input.code.trim() }
}

export async function listAdminClasses(
  db: Db,
  meta: Meta,
): Promise<{ id: string; academicYearId: string; grade: number; code: string }[]> {
  requireOrg(meta.actor)
  const rows = await db
    .selectFrom('admin_classes')
    .select(['id', 'academic_year_id', 'grade', 'code'])
    .where('school_id', '=', meta.actor.schoolId)
    .orderBy('grade')
    .orderBy('code')
    .execute()
  return rows.map((row) => ({ id: row.id, academicYearId: row.academic_year_id, grade: row.grade, code: row.code }))
}

export async function listClassLearners(
  db: Db,
  meta: Meta,
  classId: string,
): Promise<{ id: string; displayName: string }[]> {
  const item = await db.selectFrom('admin_classes').select(['id', 'school_id']).where('id', '=', classId).executeTakeFirst()
  sameSchool(item?.school_id, meta.actor.schoolId)
  requireOrg(meta.actor)
  const day = meta.clock.now().toISOString().slice(0, 10)
  const rows = await db
    .selectFrom('class_memberships')
    .innerJoin('users', 'users.id', 'class_memberships.learner_id')
    .select(['users.id as id', 'users.display_name as displayName'])
    .where('class_memberships.class_id', '=', classId)
    .where(sql<boolean>`class_memberships.valid @> ${day}::date`)
    .orderBy('users.display_name')
    .execute()
  return rows.map((row) => ({ id: row.id, displayName: row.displayName }))
}
