import type { Kysely, Transaction } from 'kysely'
import type { Database } from '@hcn/db'

type Db = Kysely<Database> | Transaction<Database>

type EventRow = {
  event_id: string
  event_type: string
  payload: Record<string, string>
  school_id: string
}

export async function notifyFromEvent(db: Db, event: EventRow): Promise<void> {
  if (event.event_type === 'ReleaseCreated') await notifyRelease(db, event)
  else if (event.event_type === 'ReviewPublished' || event.event_type === 'DecisionSuperseded') await notifyLearnerAndGuardians(db, event)
}

async function insertNotice(
  db: Db,
  row: { schoolId: string; recipientId: string; kind: string; title: string; href: string; sourceEvent: string },
): Promise<void> {
  await db
    .insertInto('notifications')
    .values({
      school_id: row.schoolId,
      recipient_id: row.recipientId,
      kind: row.kind,
      payload: { title: row.title, href: row.href },
      source_event: row.sourceEvent,
    })
    .execute()
}

async function notifyRelease(db: Db, event: EventRow): Promise<void> {
  const offeringId = event.payload.offeringId
  const pathReleaseId = event.payload.pathReleaseId
  if (!offeringId || !pathReleaseId) return
  const path = await db.selectFrom('path_releases').select(['title']).where('id', '=', pathReleaseId).executeTakeFirst()
  const learners = await db
    .selectFrom('offering_enrollments')
    .select('learner_id')
    .where('offering_id', '=', offeringId)
    .where('school_id', '=', event.school_id)
    .where('status', '=', 'active')
    .execute()
  for (const learner of learners) {
    await insertNotice(db, {
      schoolId: event.school_id,
      recipientId: learner.learner_id,
      kind: 'release_created',
      title: path?.title ?? 'Bài mới',
      href: `/hoc/lop/${offeringId}`,
      sourceEvent: event.event_id,
    })
  }
}

async function notifyLearnerAndGuardians(db: Db, event: EventRow): Promise<void> {
  const learnerId = event.payload.learnerId
  const offeringId = event.payload.offeringId
  const title = event.payload.title ?? 'Có phản hồi mới'
  if (!learnerId || !offeringId) return
  const kind = event.event_type === 'DecisionSuperseded' ? 'decision_superseded' : 'review_published'
  await insertNotice(db, {
    schoolId: event.school_id,
    recipientId: learnerId,
    kind,
    title,
    href: `/hoc/ho-so/${offeringId}`,
    sourceEvent: event.event_id,
  })
  const guardians = await db
    .selectFrom('guardian_links')
    .select('guardian_id')
    .where('learner_id', '=', learnerId)
    .where('school_id', '=', event.school_id)
    .where('status', '=', 'verified')
    .execute()
  for (const guardian of guardians) {
    await insertNotice(db, {
      schoolId: event.school_id,
      recipientId: guardian.guardian_id,
      kind,
      title,
      href: `/phu-huynh/con/${learnerId}`,
      sourceEvent: event.event_id,
    })
  }
}
