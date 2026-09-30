import { sql } from 'kysely'
import { DomainError } from '../errors.ts'
import { authorize, type Action } from '../identity/policies.ts'
import type { Db, Meta, Trx } from '../org/support.ts'

export type ReleaseRow = {
  id: string
  school_id: string
  offering_id: string
  module_version_id: string
  module_id: string
  title: string
  available_from: Date
  due_at: Date | null
  accept_until: Date | null
  late_policy: 'reject' | 'accept_marked'
  schedule_revision: number
  course_id: string
}

export async function loadRelease(db: Db | Trx, schoolId: string, releaseId: string): Promise<ReleaseRow> {
  const row = await db
    .selectFrom('module_releases')
    .innerJoin('module_versions', 'module_versions.id', 'module_releases.module_version_id')
    .innerJoin('offerings', 'offerings.id', 'module_releases.offering_id')
    .select([
      'module_releases.id',
      'module_releases.school_id',
      'module_releases.offering_id',
      'module_releases.module_version_id',
      'module_releases.available_from',
      'module_releases.due_at',
      'module_releases.accept_until',
      'module_releases.late_policy',
      'module_releases.schedule_revision',
      'module_versions.title',
      'module_versions.module_id',
      'offerings.course_id',
    ])
    .where('module_releases.id', '=', releaseId)
    .executeTakeFirst()
  if (!row || row.school_id !== schoolId) throw new DomainError('NOT_FOUND')
  return row
}

export function opened(row: ReleaseRow, now: Date): boolean {
  return row.available_from.getTime() <= now.getTime()
}

export async function activeEnrollment(db: Db | Trx, meta: Meta, offeringId: string, learnerId = meta.actor.userId): Promise<boolean> {
  const row = await db
    .selectFrom('offering_enrollments')
    .select('id')
    .where('offering_id', '=', offeringId)
    .where('learner_id', '=', learnerId)
    .where('school_id', '=', meta.actor.schoolId)
    .where('status', '=', 'active')
    .executeTakeFirst()
  return Boolean(row)
}

export async function capabilities(db: Db | Trx, meta: Meta, offeringId: string): Promise<string[]> {
  const row = await db
    .selectFrom('teacher_assignments')
    .select('capabilities')
    .where('offering_id', '=', offeringId)
    .where('teacher_id', '=', meta.actor.userId)
    .where('school_id', '=', meta.actor.schoolId)
    .where(sql<boolean>`valid @> now()`)
    .executeTakeFirst()
  return row?.capabilities ?? []
}

export async function guardianOfEnrolled(db: Db | Trx, meta: Meta, offeringId: string): Promise<boolean> {
  const row = await db
    .selectFrom('guardian_links')
    .innerJoin('offering_enrollments', 'offering_enrollments.learner_id', 'guardian_links.learner_id')
    .select('guardian_links.id')
    .where('guardian_links.guardian_id', '=', meta.actor.userId)
    .where('guardian_links.school_id', '=', meta.actor.schoolId)
    .where('guardian_links.status', '=', 'verified')
    .where('offering_enrollments.offering_id', '=', offeringId)
    .where('offering_enrollments.status', '=', 'active')
    .executeTakeFirst()
  return Boolean(row)
}

/** HS: ghi danh active và đã tới giờ mở. Sai thì 404, không 403. */
export async function learnerRelease(db: Db | Trx, meta: Meta, release: ReleaseRow): Promise<void> {
  const enrolled = await activeEnrollment(db, meta, release.offering_id)
  if (!enrolled || !opened(release, meta.clock.now())) throw new DomainError('NOT_FOUND')
  authorize(meta.actor, 'release.read_learner', { enrolled: true })
}

export async function requireStudentAction(db: Db | Trx, meta: Meta, release: ReleaseRow, action: Action): Promise<void> {
  const enrolled = await activeEnrollment(db, meta, release.offering_id)
  if (!enrolled || !opened(release, meta.clock.now())) throw new DomainError('NOT_FOUND')
  authorize(meta.actor, action, { enrolled: true })
}

export function assertSubmitOpen(release: ReleaseRow, now: Date): void {
  if (release.accept_until && now.getTime() > release.accept_until.getTime()) throw new DomainError('RELEASE_CLOSED')
  if (release.due_at && now.getTime() > release.due_at.getTime() && release.late_policy === 'reject') {
    throw new DomainError('RELEASE_CLOSED')
  }
}

export type AppliedSubmission = {
  types: Array<'text' | 'code' | 'rich'>
  allowFiles: boolean
  maxFiles: number
}

export function appliedSubmission(config: unknown): AppliedSubmission {
  const row = config && typeof config === 'object' ? (config as { types?: unknown; allowFiles?: unknown; maxFiles?: unknown }) : {}
  const allowed = new Set(['text', 'code', 'rich'])
  const types = Array.isArray(row.types)
    ? row.types.filter((item): item is 'text' | 'code' | 'rich' => typeof item === 'string' && allowed.has(item))
    : []
  return {
    types: types.length > 0 ? types : ['text'],
    allowFiles: row.allowFiles === true,
    maxFiles: typeof row.maxFiles === 'number' ? row.maxFiles : 0,
  }
}
