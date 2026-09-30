import { sql } from 'kysely'
import { DomainError } from '../errors.ts'
import { sameSchool, type Db, type Meta } from './support.ts'

export async function listMyChildren(db: Db, meta: Meta): Promise<{ learnerId: string; name: string; className: string }[]> {
  if (!meta.actor.roles.includes('guardian')) return []
  const day = meta.clock.now().toISOString().slice(0, 10)
  const rows = await db
    .selectFrom('guardian_links')
    .innerJoin('users', 'users.id', 'guardian_links.learner_id')
    .select(['guardian_links.learner_id as learnerId', 'users.display_name as name'])
    .where('guardian_links.school_id', '=', meta.actor.schoolId)
    .where('guardian_links.guardian_id', '=', meta.actor.userId)
    .where('guardian_links.status', '=', 'verified')
    .orderBy('users.display_name')
    .execute()
  const result = []
  for (const row of rows) {
    const seat = await db
      .selectFrom('class_memberships')
      .innerJoin('admin_classes', 'admin_classes.id', 'class_memberships.class_id')
      .select(['admin_classes.code as code'])
      .where('class_memberships.learner_id', '=', row.learnerId)
      .where(sql<boolean>`class_memberships.valid @> ${day}::date`)
      .executeTakeFirst()
    result.push({ learnerId: row.learnerId, name: row.name, className: seat?.code ?? '' })
  }
  return result
}

export async function getChildOverview(db: Db, meta: Meta, learnerId: string): Promise<{ learnerId: string; offerings: { offeringId: string; title: string }[] }> {
  const link = await db
    .selectFrom('guardian_links')
    .select(['id', 'school_id', 'status'])
    .where('guardian_id', '=', meta.actor.userId)
    .where('learner_id', '=', learnerId)
    .where('status', '=', 'verified')
    .executeTakeFirst()
  sameSchool(link?.school_id, meta.actor.schoolId)
  if (!link) throw new DomainError('NOT_FOUND')
  const offerings = await db
    .selectFrom('offering_enrollments')
    .innerJoin('offerings', 'offerings.id', 'offering_enrollments.offering_id')
    .select(['offerings.id as offeringId', 'offerings.title as title'])
    .where('offering_enrollments.learner_id', '=', learnerId)
    .where('offering_enrollments.status', '=', 'active')
    .where('offerings.school_id', '=', meta.actor.schoolId)
    .execute()
  return { learnerId, offerings }
}
