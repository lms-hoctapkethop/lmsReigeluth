import type { Kysely } from 'kysely'
import type { Database } from '@hcn/db'
import { uuidV5 } from './uuid-v5.ts'

/** Nhắc hạn trong 24 giờ tới. Chạy lại trong cùng giờ không tạo thêm thông báo. */
export async function runDueSoon(db: Kysely<Database>, now: Date): Promise<number> {
  const until = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  const items = await db
    .selectFrom('module_releases')
    .innerJoin('module_items', 'module_items.module_version_id', 'module_releases.module_version_id')
    .select([
      'module_releases.id as releaseId',
      'module_releases.school_id as schoolId',
      'module_releases.offering_id as offeringId',
      'module_releases.due_at as dueAt',
      'module_items.id as itemId',
      'module_items.title as title',
    ])
    .where('module_items.completion_rule', '=', 'submit')
    .where('module_releases.due_at', '>', now)
    .where('module_releases.due_at', '<=', until)
    .execute()
  let created = 0
  for (const item of items) {
    const learners = await db
      .selectFrom('offering_enrollments')
      .select('learner_id')
      .where('offering_id', '=', item.offeringId)
      .where('school_id', '=', item.schoolId)
      .where('status', '=', 'active')
      .execute()
    for (const learner of learners) {
      const submitted = await db
        .selectFrom('submissions')
        .select('id')
        .where('learner_id', '=', learner.learner_id)
        .where('module_release_id', '=', item.releaseId)
        .where('module_item_id', '=', item.itemId)
        .where('current_version_no', '>', 0)
        .executeTakeFirst()
      if (submitted) continue
      const source = uuidV5(`due_soon:${item.releaseId}:${item.itemId}:${learner.learner_id}`)
      const inserted = await db.transaction().execute(async (trx) => {
        const seen = await trx
          .insertInto('processed_events')
          .values({ event_id: source, consumer: 'due_soon' })
          .onConflict((conflict) => conflict.columns(['event_id', 'consumer']).doNothing())
          .returning('event_id')
          .executeTakeFirst()
        if (!seen) return false
        await trx
          .insertInto('notifications')
          .values({
            school_id: item.schoolId,
            recipient_id: learner.learner_id,
            kind: 'due_soon',
            payload: { title: item.title, href: `/hoc/bai/${item.releaseId}/muc/${item.itemId}` },
            source_event: source,
          })
          .execute()
        return true
      })
      if (inserted) created += 1
    }
  }
  return created
}
