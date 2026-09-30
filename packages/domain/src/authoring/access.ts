import { sql } from 'kysely'
import { DomainError } from '../errors.ts'
import { authorize, type Actor } from '../identity/policies.ts'
import type { Db, Trx } from '../org/support.ts'

export async function authorAssigned(db: Db | Trx, actor: Actor, courseId: string): Promise<boolean> {
  const row = await db
    .selectFrom('teacher_assignments')
    .innerJoin('offerings', 'offerings.id', 'teacher_assignments.offering_id')
    .select('teacher_assignments.id')
    .where('teacher_assignments.teacher_id', '=', actor.userId)
    .where('teacher_assignments.school_id', '=', actor.schoolId)
    .where('offerings.course_id', '=', courseId)
    .where('offerings.school_id', '=', actor.schoolId)
    .where(sql<boolean>`teacher_assignments.capabilities @> ARRAY['author']::text[]`)
    .where(sql<boolean>`teacher_assignments.valid @> now()`)
    .executeTakeFirst()
  return Boolean(row)
}

export async function loadModule(db: Db | Trx, actor: Actor, moduleId: string): Promise<{ courseId: string; ownerId: string }> {
  const row = await db
    .selectFrom('modules')
    .select(['course_id', 'owner_id', 'school_id'])
    .where('id', '=', moduleId)
    .executeTakeFirst()
  if (!row || row.school_id !== actor.schoolId) throw new DomainError('NOT_FOUND')
  return { courseId: row.course_id, ownerId: row.owner_id }
}

async function isEditor(db: Db | Trx, moduleId: string, userId: string): Promise<boolean> {
  const row = await db
    .selectFrom('module_collaborators')
    .select('role')
    .where('module_id', '=', moduleId)
    .where('user_id', '=', userId)
    .executeTakeFirst()
  return row?.role === 'editor'
}

export async function authorizeModule(
  db: Db | Trx,
  actor: Actor,
  moduleId: string,
  action: 'module.edit' | 'module.publish',
): Promise<{ courseId: string }> {
  const moduleRow = await loadModule(db, actor, moduleId)
  const assigned = await authorAssigned(db, actor, moduleRow.courseId)
  const editor = moduleRow.ownerId === actor.userId ? false : await isEditor(db, moduleId, actor.userId)
  authorize(actor, action, {
    authorAssigned: assigned,
    moduleOwner: moduleRow.ownerId === actor.userId,
    moduleEditor: editor,
  })
  return { courseId: moduleRow.courseId }
}
