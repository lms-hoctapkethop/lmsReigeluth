import { DomainError } from '../errors.ts'
import type { Db, Meta } from '../org/support.ts'

export type NotificationDto = {
  id: string
  kind: string
  title: string
  link: string
  createdAt: string
  readAt: string | null
}

export async function listNotifications(db: Db, meta: Meta, unread: boolean): Promise<NotificationDto[]> {
  let query = db
    .selectFrom('notifications')
    .select(['id', 'kind', 'payload', 'created_at', 'read_at'])
    .where('recipient_id', '=', meta.actor.userId)
    .where('school_id', '=', meta.actor.schoolId)
    .orderBy('created_at', 'desc')
    .limit(50)
  if (unread) query = query.where('read_at', 'is', null)
  const rows = await query.execute()
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    title: row.payload.title ?? '',
    link: row.payload.href ?? '',
    createdAt: row.created_at.toISOString(),
    readAt: row.read_at ? row.read_at.toISOString() : null,
  }))
}

export async function markNotificationRead(db: Db, meta: Meta, notificationId: string): Promise<void> {
  const row = await db
    .selectFrom('notifications')
    .select(['id', 'recipient_id', 'school_id'])
    .where('id', '=', notificationId)
    .executeTakeFirst()
  if (!row || row.recipient_id !== meta.actor.userId || row.school_id !== meta.actor.schoolId) throw new DomainError('NOT_FOUND')
  await db.updateTable('notifications').set({ read_at: meta.clock.now() }).where('id', '=', notificationId).execute()
}
