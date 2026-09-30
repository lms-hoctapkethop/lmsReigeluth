import { randomUUID } from 'node:crypto'
import { DomainError } from '../errors.ts'
import { audit, outbox, requireOrg, type Db, type Meta } from './support.ts'

export async function createCourse(
  db: Db,
  meta: Meta,
  input: { subjectCode: string; grade: number; title: string },
): Promise<{ id: string; subjectCode: string; grade: number; title: string }> {
  requireOrg(meta.actor)
  const subject = await db.selectFrom('subjects').select(['code']).where('code', '=', input.subjectCode).executeTakeFirst()
  if (!subject || !Number.isInteger(input.grade) || input.grade < 1 || input.grade > 12 || input.title.trim().length === 0) {
    throw new DomainError('VALIDATION_FAILED')
  }
  const id = randomUUID()
  await db.transaction().execute(async (trx) => {
    await trx
      .insertInto('courses')
      .values({
        id,
        school_id: meta.actor.schoolId,
        subject_code: input.subjectCode,
        grade: input.grade,
        title: input.title.trim(),
        orientation: null,
      })
      .execute()
    await audit(trx, meta, {
      action: 'course.create',
      objectType: 'course',
      objectId: id,
      details: { id, subjectCode: input.subjectCode, status: 'created' },
    })
    await outbox(trx, {
      schoolId: meta.actor.schoolId,
      aggregateType: 'course',
      aggregateId: id,
      eventType: 'CourseCreated',
      payload: { courseId: id, status: 'created' },
    })
  })
  return { id, subjectCode: input.subjectCode, grade: input.grade, title: input.title.trim() }
}

export async function listCourses(
  db: Db,
  meta: Meta,
): Promise<{ id: string; subjectCode: string; grade: number; title: string }[]> {
  requireOrg(meta.actor)
  const rows = await db
    .selectFrom('courses')
    .select(['id', 'subject_code', 'grade', 'title'])
    .where('school_id', '=', meta.actor.schoolId)
    .orderBy('grade')
    .orderBy('title')
    .execute()
  return rows.map((row) => ({ id: row.id, subjectCode: row.subject_code, grade: row.grade, title: row.title }))
}
