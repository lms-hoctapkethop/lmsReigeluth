import type { Kysely } from 'kysely'
import type { Database, Role } from '@hcn/db'
import { DomainError } from '../errors.ts'
import { writeAudit } from './audit.ts'
import { getMe, type MeResult } from './getMe.ts'
import { listActiveMemberships } from './memberships.ts'
import { authorize, type Actor } from './policies.ts'

export async function switchContext(
  db: Kysely<Database>,
  actor: Actor,
  sessionHash: string,
  displayName: string,
  csrfToken: string,
  input: { schoolId: string; role: Role },
  requestId: string,
): Promise<MeResult> {
  const memberships = await listActiveMemberships(db, actor.userId)
  const next = memberships.find((item) => item.schoolId === input.schoolId && item.role === input.role)
  authorize(actor, 'me.switch_context', { membershipActive: next !== undefined })
  if (!next) throw new DomainError('FORBIDDEN')
  await db.transaction().execute(async (trx) => {
    await trx
      .updateTable('sessions')
      .set({ context: { school_id: next.schoolId, role: next.role } })
      .where('id_hash', '=', sessionHash)
      .where('revoked_at', 'is', null)
      .execute()
    await writeAudit(trx, {
      schoolId: next.schoolId,
      actorId: actor.userId,
      action: 'context_switched',
      objectType: 'membership',
      objectId: next.id,
      requestId,
      details: { schoolId: next.schoolId, membershipId: next.id },
    })
  })
  return getMe(
    db,
    { userId: actor.userId, schoolId: next.schoolId, roles: [next.role] },
    displayName,
    csrfToken,
  )
}
