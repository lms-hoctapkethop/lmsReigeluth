import type { Database } from '@hcn/db'
import type { Kysely, Transaction } from 'kysely'

type AuditDb = Kysely<Database> | Transaction<Database>

export async function writeAudit(
  db: AuditDb,
  entry: {
    schoolId: string | null
    actorId: string | null
    action: string
    objectType: string
    objectId: string
    requestId: string
    details: Record<string, string>
  },
): Promise<void> {
  await db
    .insertInto('audit_log')
    .values({
      school_id: entry.schoolId,
      actor_id: entry.actorId,
      action: entry.action,
      object_type: entry.objectType,
      object_id: entry.objectId,
      request_id: entry.requestId,
      details: entry.details,
    })
    .execute()
}
