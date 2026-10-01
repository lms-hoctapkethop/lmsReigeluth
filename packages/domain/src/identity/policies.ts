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
  /** Giáo viên đang có phân công `author` trên một offering của khóa. */
  authorAssigned?: boolean
  moduleOwner?: boolean
  moduleEditor?: boolean
  releaseAssigned?: boolean
  enrolled?: boolean
  teacherAssigned?: boolean
  guardianLinked?: boolean
  reviewAssigned?: boolean
  viewAssigned?: boolean
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
      return actor.roles.includes('admin') ? { allow: true } : { allow: false, reason: 'CAPABILITY_MISSING' }
    case 'curriculum.read':
      return actor.roles.some((role) => role === 'admin' || role === 'teacher' || role === 'student' || role === 'guardian')
        ? { allow: true }
        : { allow: false, reason: 'CAPABILITY_MISSING' }
    case 'curriculum.propose':
      return actor.roles.includes('teacher') ? { allow: true } : { allow: false, reason: 'CAPABILITY_MISSING' }
    case 'curriculum.review':
      return actor.roles.some((role) => role === 'admin' || role === 'teacher')
        ? { allow: true }
        : { allow: false, reason: 'CAPABILITY_MISSING' }
    case 'module.create':
      if (!actor.roles.includes('teacher')) return { allow: false, reason: 'CAPABILITY_MISSING' }
      return facts.authorAssigned ? { allow: true } : { allow: false, reason: 'NOT_ASSIGNED' }
    case 'module.edit':
    case 'module.publish':
      if (!actor.roles.includes('teacher')) return { allow: false, reason: 'CAPABILITY_MISSING' }
      if (!facts.authorAssigned) return { allow: false, reason: 'NOT_ASSIGNED' }
      return facts.moduleOwner || facts.moduleEditor ? { allow: true } : { allow: false, reason: 'NOT_ASSIGNED' }
    case 'release.create':
    case 'release.change':
      if (!actor.roles.includes('teacher')) return { allow: false, reason: 'CAPABILITY_MISSING' }
      return facts.releaseAssigned ? { allow: true } : { allow: false, reason: 'NOT_ASSIGNED' }
    case 'release.read_learner':
      if (actor.roles.includes('student')) return facts.enrolled ? { allow: true } : { allow: false, reason: 'NOT_ENROLLED' }
      if (actor.roles.includes('teacher')) return facts.teacherAssigned ? { allow: true } : { allow: false, reason: 'NOT_ASSIGNED' }
      if (actor.roles.includes('guardian')) return facts.guardianLinked ? { allow: true } : { allow: false, reason: 'NOT_LINKED' }
      return { allow: false, reason: 'CAPABILITY_MISSING' }
    case 'progress.write':
    case 'submission.draft':
    case 'submission.create':
      if (!actor.roles.includes('student')) return { allow: false, reason: 'CAPABILITY_MISSING' }
      return facts.enrolled ? { allow: true } : { allow: false, reason: 'NOT_ENROLLED' }
    case 'submission.read':
      if (actor.roles.includes('student')) return facts.enrolled ? { allow: true } : { allow: false, reason: 'NOT_ENROLLED' }
      if (actor.roles.includes('teacher')) {
        return facts.reviewAssigned || facts.viewAssigned ? { allow: true } : { allow: false, reason: 'NOT_ASSIGNED' }
      }
      if (actor.roles.includes('guardian')) return facts.guardianLinked ? { allow: true } : { allow: false, reason: 'NOT_LINKED' }
      return { allow: false, reason: 'CAPABILITY_MISSING' }
    case 'attempt.*':
      if (!actor.roles.includes('student')) return { allow: false, reason: 'CAPABILITY_MISSING' }
      return facts.enrolled ? { allow: true } : { allow: false, reason: 'NOT_ENROLLED' }
    case 'review.*':
    case 'decision.supersede':
      if (!actor.roles.includes('teacher')) return { allow: false, reason: 'CAPABILITY_MISSING' }
      return facts.reviewAssigned ? { allow: true } : { allow: false, reason: 'NOT_ASSIGNED' }
    case 'review.read_published':
      if (actor.roles.includes('student')) return facts.enrolled ? { allow: true } : { allow: false, reason: 'NOT_ENROLLED' }
      if (actor.roles.includes('teacher')) {
        return facts.teacherAssigned ? { allow: true } : { allow: false, reason: 'NOT_ASSIGNED' }
      }
      if (actor.roles.includes('guardian')) return facts.guardianLinked ? { allow: true } : { allow: false, reason: 'NOT_LINKED' }
      return { allow: false, reason: 'CAPABILITY_MISSING' }
    case 'family_support.*':
      if (!actor.roles.includes('guardian')) return { allow: false, reason: 'CAPABILITY_MISSING' }
      return facts.guardianLinked ? { allow: true } : { allow: false, reason: 'NOT_LINKED' }
    case 'needs.read':
      if (actor.roles.includes('teacher')) return facts.teacherAssigned ? { allow: true } : { allow: false, reason: 'NOT_ASSIGNED' }
      if (actor.roles.includes('student')) return facts.enrolled ? { allow: true } : { allow: false, reason: 'NOT_ENROLLED' }
      return { allow: false, reason: 'CAPABILITY_MISSING' }
    case 'heatmap.read':
      if (!actor.roles.includes('teacher')) return { allow: false, reason: 'CAPABILITY_MISSING' }
      return facts.teacherAssigned ? { allow: true } : { allow: false, reason: 'NOT_ASSIGNED' }
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
