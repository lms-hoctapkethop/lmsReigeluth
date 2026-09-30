import type { Database } from '@hcn/db'
import type { Kysely } from 'kysely'
import { DomainError } from '../errors.ts'
import { listActiveMemberships } from './memberships.ts'
import { authorize, type Actor } from './policies.ts'

export type MeResult = {
  userId: string
  displayName: string
  contexts: { schoolId: string; role: Actor['roles'][number]; schoolName: string }[]
  activeContext: { schoolId: string; role: Actor['roles'][number] }
  csrfToken: string
}

export async function getMe(db: Kysely<Database>, actor: Actor, displayName: string, csrfToken: string): Promise<MeResult> {
  authorize(actor, 'me.read', {})
  const activeRole = actor.roles[0]
  if (!activeRole) throw new DomainError('FORBIDDEN')
  const memberships = await listActiveMemberships(db, actor.userId)
  const active = memberships.find((item) => item.schoolId === actor.schoolId && item.role === activeRole)
  if (!active) throw new DomainError('FORBIDDEN')
  return {
    userId: actor.userId,
    displayName,
    contexts: memberships.map((item) => ({
      schoolId: item.schoolId,
      role: item.role,
      schoolName: item.schoolName,
    })),
    activeContext: { schoolId: active.schoolId, role: active.role },
    csrfToken,
  }
}
