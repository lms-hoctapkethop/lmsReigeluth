import { sql } from 'kysely'
import { DomainError } from '../errors.ts'
import type { OfferingDto } from './createOffering.ts'
import { requireOrg, sameSchool, type Db, type Meta } from './support.ts'

export async function listMyOfferings(db: Db, meta: Meta): Promise<OfferingDto[]> {
  const role = meta.actor.roles[0]
  const at = meta.clock.now().toISOString()
  let query = db
    .selectFrom('offerings')
    .innerJoin('courses', 'courses.id', 'offerings.course_id')
    .select([
      'offerings.id as id',
      'offerings.code as code',
      'offerings.title as title',
      'courses.subject_code as subjectCode',
      'courses.grade as grade',
      'offerings.term as term',
    ])
    .where('offerings.school_id', '=', meta.actor.schoolId)
  if (role === 'teacher') {
    query = query.where(
      sql<boolean>`exists (select 1 from teacher_assignments ta where ta.offering_id = offerings.id and ta.teacher_id = ${meta.actor.userId} and ta.valid @> ${at}::timestamptz)`,
    )
  } else if (role === 'student') {
    query = query.where(
      sql<boolean>`exists (select 1 from offering_enrollments en where en.offering_id = offerings.id and en.learner_id = ${meta.actor.userId} and en.status = 'active')`,
    )
  } else if (role !== 'admin') {
    return []
  }
  const rows = await query.orderBy('offerings.title').execute()
  const myRole = role === 'admin' || role === 'teacher' || role === 'student' ? role : 'student'
  return rows.map((row) => ({ ...row, myRole }))
}

export async function getOffering(db: Db, meta: Meta, offeringId: string): Promise<OfferingDto> {
  const offering = await db.selectFrom('offerings').select(['id', 'school_id']).where('id', '=', offeringId).executeTakeFirst()
  sameSchool(offering?.school_id, meta.actor.schoolId)
  const rows = await listMyOfferings(db, meta)
  const found = rows.find((row) => row.id === offeringId)
  if (!found) throw new DomainError('NOT_FOUND')
  return found
}

export async function getAdminOffering(db: Db, meta: Meta, offeringId: string): Promise<{
  id: string
  code: string
  title: string
  courseId: string
  academicYearId: string
  term: number
  teachers: { id: string; teacherId: string; displayName: string; capabilities: string[] }[]
  learners: { id: string; displayName: string; status: string }[]
}> {
  const offering = await db
    .selectFrom('offerings')
    .select(['id', 'school_id', 'code', 'title', 'course_id', 'academic_year_id', 'term'])
    .where('id', '=', offeringId)
    .executeTakeFirst()
  sameSchool(offering?.school_id, meta.actor.schoolId)
  requireOrg(meta.actor)
  if (!offering) throw new DomainError('NOT_FOUND')
  const at = meta.clock.now().toISOString()
  const teachers = await db
    .selectFrom('teacher_assignments')
    .innerJoin('users', 'users.id', 'teacher_assignments.teacher_id')
    .select([
      'teacher_assignments.id as id',
      'teacher_assignments.teacher_id as teacherId',
      'users.display_name as displayName',
      'teacher_assignments.capabilities as capabilities',
    ])
    .where('teacher_assignments.offering_id', '=', offeringId)
    .where(sql<boolean>`teacher_assignments.valid @> ${at}::timestamptz`)
    .execute()
  const learners = await db
    .selectFrom('offering_enrollments')
    .innerJoin('users', 'users.id', 'offering_enrollments.learner_id')
    .select(['users.id as id', 'users.display_name as displayName', 'offering_enrollments.status as status'])
    .where('offering_enrollments.offering_id', '=', offeringId)
    .execute()
  return {
    id: offering.id,
    code: offering.code,
    title: offering.title,
    courseId: offering.course_id,
    academicYearId: offering.academic_year_id,
    term: offering.term,
    teachers,
    learners,
  }
}
