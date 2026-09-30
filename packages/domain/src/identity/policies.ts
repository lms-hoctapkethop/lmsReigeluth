import type { Role } from '@hcn/db'
import { DomainError } from '../errors.ts'

export type { Role }

export type Actor = {
  userId: string
  schoolId: string
  roles: Role[]
}

export type Action =
  | 'me.read'
  | 'me.switch_context'
  | 'org.manage'
  | 'guardian_link.verify'
  | 'guardian_link.revoke'
  | 'curriculum.read'
  | 'curriculum.propose'
  | 'curriculum.review'
  | 'module.create'
  | 'module.edit'
  | 'module.publish'
  | 'release.create'
  | 'release.change'
  | 'release.read_learner'
  | 'progress.write'
  | 'submission.draft'
  | 'submission.create'
  | 'submission.read'
  | 'attempt.*'
  | 'review.*'
  | 'review.read_published'
  | 'decision.supersede'
  | 'needs.read'
  | 'heatmap.read'
  | 'family_support.*'

export type Facts = {
  membershipActive?: boolean
}

export type Decision =
  | { allow: true }
  | {
      allow: false
      reason: 'NOT_MEMBER' | 'NOT_ASSIGNED' | 'NOT_ENROLLED' | 'NOT_LINKED' | 'NOT_PUBLISHED' | 'CAPABILITY_MISSING'
    }

export function can(actor: Actor, action: Action, facts: Facts): Decision {
  switch (action) {
    case 'me.read':
      return actor.userId ? { allow: true } : { allow: false, reason: 'NOT_MEMBER' }
    case 'me.switch_context':
      return facts.membershipActive ? { allow: true } : { allow: false, reason: 'NOT_MEMBER' }
    case 'org.manage':
    case 'guardian_link.verify':
    case 'guardian_link.revoke':
      // TODO(M2)
      return { allow: false, reason: 'CAPABILITY_MISSING' }
    case 'curriculum.read':
    case 'curriculum.propose':
    case 'curriculum.review':
      // TODO(M3)
      return { allow: false, reason: 'CAPABILITY_MISSING' }
    case 'module.create':
    case 'module.edit':
    case 'module.publish':
      // TODO(M4)
      return { allow: false, reason: 'CAPABILITY_MISSING' }
    case 'release.create':
    case 'release.change':
    case 'release.read_learner':
    case 'progress.write':
    case 'submission.draft':
    case 'submission.create':
    case 'submission.read':
      // TODO(M5)
      return { allow: false, reason: 'CAPABILITY_MISSING' }
    case 'attempt.*':
      // TODO(M6)
      return { allow: false, reason: 'CAPABILITY_MISSING' }
    case 'review.*':
    case 'review.read_published':
    case 'decision.supersede':
    case 'needs.read':
    case 'heatmap.read':
    case 'family_support.*':
      // TODO(M7)
      return { allow: false, reason: 'CAPABILITY_MISSING' }
    default: {
      const unreachable: never = action
      return unreachable
    }
  }
}

export function authorize(actor: Actor, action: Action, facts: Facts): void {
  const decision = can(actor, action, facts)
  if (!decision.allow) throw new DomainError('FORBIDDEN')
}
