import { randomUUID } from 'node:crypto'
import { DomainError } from '../errors.ts'
import { audit, outbox, pgCode, requireOrg, sameSchool, type Db, type Meta } from './support.ts'

export type OfferingDto = {
  id: string
  code: string
  title: string
  courseId: string
  subjectCode: string
  grade: number
  term: number
  myRole: 'teacher' | 'student' | 'admin'
}

export async function createOffering(
  db: Db,
  meta: Meta,
  input: { courseId: string; academicYearId: string; term: number; code: string; title: string; classIds?: string[] },
): Promise<OfferingDto> {
  const course = await db.selectFrom('courses').select(['id', 'school_id', 'subject_code', 'grade']).where('id', '=', input.courseId).executeTakeFirst()
  sameSchool(course?.school_id, meta.actor.schoolId)
  const year = await db.selectFrom('academic_years').select(['id', 'school_id']).where('id', '=', input.academicYearId).executeTakeFirst()
  sameSchool(year?.school_id, meta.actor.schoolId)
  requireOrg(meta.actor)
  if (input.term !== 1 && input.term !== 2) throw new DomainError('VALIDATION_FAILED')
  if (!/^[A-Z0-9_-]{3,40}$/.test(input.code) || input.title.trim().length === 0) throw new DomainError('VALIDATION_FAILED')
  const classIds = input.classIds ?? []
  if (classIds.length > 0) {
    const found = await db.selectFrom('admin_classes').select(['id', 'school_id', 'academic_year_id']).where('id', 'in', classIds).execute()
    if (found.length !== classIds.length) throw new DomainError('NOT_FOUND')
    for (const item of found) {
      sameSchool(item.school_id, meta.actor.schoolId)
      if (item.academic_year_id !== input.academicYearId) throw new DomainError('VALIDATION_FAILED')
    }
  }
  const id = randomUUID()
  try {
    await db.transaction().execute(async (trx) => {
      await trx
        .insertInto('offerings')
        .values({
          id,
          school_id: meta.actor.schoolId,
          course_id: input.courseId,
          academic_year_id: input.academicYearId,
          term: input.term,
          code: input.code,
          title: input.title.trim(),
          status: 'active',
        })
        .execute()
      for (const classId of classIds) {
        await trx.insertInto('offering_class_links').values({ offering_id: id, class_id: classId, school_id: meta.actor.schoolId }).execute()
      }
      await audit(trx, meta, {
        action: 'offering.create',
        objectType: 'offering',
        objectId: id,
        details: { id, status: 'active' },
      })
      await outbox(trx, {
        schoolId: meta.actor.schoolId,
        aggregateType: 'offering',
        aggregateId: id,
        eventType: 'OfferingCreated',
        payload: { offeringId: id, status: 'active' },
      })
    })
  } catch (error) {
    if (pgCode(error) === '23505') throw new DomainError('REVISION_CONFLICT')
    throw error
  }
  return {
    id,
    code: input.code,
    title: input.title.trim(),
    courseId: input.courseId,
    subjectCode: course?.subject_code ?? '',
    grade: course?.grade ?? 0,
    term: input.term,
    myRole: 'admin',
  }
}
