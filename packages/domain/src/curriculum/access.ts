import type { Db, Meta } from './support.ts'

export async function curriculumAccess(db: Db, meta: Meta): Promise<{ propose: boolean; review: boolean }> {
  const propose = meta.actor.roles.includes('teacher')
  const row = await db
    .selectFrom('curriculum_reviewers')
    .select(['user_id'])
    .where('user_id', '=', meta.actor.userId)
    .executeTakeFirst()
  const review = Boolean(row) && (meta.actor.roles.includes('teacher') || meta.actor.roles.includes('admin'))
  return { propose, review }
}
