import { sql, type Kysely, type Transaction } from 'kysely'
import type { Database } from '@hcn/db'
import { DomainError } from '../errors.ts'
import { writeAudit } from '../identity/audit.ts'
import { authorize, type Actor, type Action } from '../identity/policies.ts'
import type { Clock } from './clock.ts'

export type Db = Kysely<Database>
export type Trx = Transaction<Database>
export type Meta = { actor: Actor; requestId: string; clock: Clock }

export function requireOrg(actor: Actor): void {
  authorize(actor, 'org.manage', {})
}

export function requireGuardian(actor: Actor, action: Extract<Action, 'guardian_link.verify' | 'guardian_link.revoke'>): void {
  authorize(actor, action, {})
}

export function sameSchool(schoolId: string | null | undefined, actorSchoolId: string): void {
  if (schoolId !== actorSchoolId) throw new DomainError('NOT_FOUND')
}

export async function audit(
  db: Db | Trx,
  meta: Meta,
  entry: { action: string; objectType: string; objectId: string; details: Record<string, string> },
): Promise<void> {
  await writeAudit(db, {
    schoolId: meta.actor.schoolId,
    actorId: meta.actor.userId,
    action: entry.action,
    objectType: entry.objectType,
    objectId: entry.objectId,
    requestId: meta.requestId,
    details: entry.details,
  })
}

export async function outbox(
  db: Db | Trx,
  event: { schoolId: string; aggregateType: string; aggregateId: string; eventType: string; payload: Record<string, string> },
): Promise<void> {
  await db
    .insertInto('outbox_events')
    .values({
      school_id: event.schoolId,
      aggregate_type: event.aggregateType,
      aggregate_id: event.aggregateId,
      event_type: event.eventType,
      payload: event.payload,
    })
    .execute()
}

export function pgCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') return error.code
  return undefined
}

export function dayOf(clock: Clock): string {
  return clock.now().toISOString().slice(0, 10)
}

export async function currentAcademicYear(db: Db | Trx, schoolId: string, clock: Clock): Promise<{ id: string } | undefined> {
  const day = dayOf(clock)
  const containing = await db
    .selectFrom('academic_years')
    .select(['id'])
    .where('school_id', '=', schoolId)
    .where(sql<boolean>`starts_on <= ${day}::date`)
    .where(sql<boolean>`ends_on >= ${day}::date`)
    .orderBy('starts_on', 'desc')
    .executeTakeFirst()
  if (containing) return containing
  return db.selectFrom('academic_years').select(['id']).where('school_id', '=', schoolId).orderBy('ends_on', 'desc').executeTakeFirst()
}
