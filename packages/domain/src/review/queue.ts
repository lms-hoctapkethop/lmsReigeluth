import { sql } from 'kysely'
import { DomainError } from '../errors.ts'
import type { Db, Meta } from '../org/support.ts'
import { requireReviewTeacher } from './load.ts'

export type QueueItem = {
  submissionId: string
  submissionVersionId: string
  learnerId: string
  learnerName: string
  itemTitle: string
  versionNo: number
  submittedAt: string
  isLate: boolean
  status: string
}

export async function getReviewQueue(
  db: Db,
  meta: Meta,
  offeringId: string,
  filter: { status?: string; late?: boolean; itemId?: string; cursor?: string; limit: number },
): Promise<{ items: QueueItem[]; nextCursor: string | null }> {
  const offering = await db.selectFrom('offerings').select(['id', 'school_id']).where('id', '=', offeringId).executeTakeFirst()
  if (!offering || offering.school_id !== meta.actor.schoolId) throw new DomainError('NOT_FOUND')
  await requireReviewTeacher(db, meta, offeringId)
  const cursor = decodeCursor(filter.cursor)
  let query = db
    .selectFrom('submissions')
    .innerJoin('submission_versions', (join) =>
      join.onRef('submission_versions.submission_id', '=', 'submissions.id').onRef('submission_versions.version_no', '=', 'submissions.current_version_no'),
    )
    .innerJoin('module_releases', 'module_releases.id', 'submissions.module_release_id')
    .innerJoin('module_items', 'module_items.id', 'submissions.module_item_id')
    .innerJoin('users', 'users.id', 'submissions.learner_id')
    .select([
      'submissions.id as submissionId',
      'submissions.status as status',
      'submissions.learner_id as learnerId',
      'users.display_name as learnerName',
      'module_items.title as itemTitle',
      'submission_versions.id as submissionVersionId',
      'submission_versions.version_no as versionNo',
      'submission_versions.submitted_at as submittedAt',
      'submission_versions.is_late as isLate',
    ])
    .where('module_releases.offering_id', '=', offeringId)
    .where('submissions.school_id', '=', meta.actor.schoolId)
    .where('submissions.current_version_no', '>', 0)
    .where(sql<boolean>`NOT EXISTS (
      SELECT 1 FROM reviews r
      WHERE r.submission_version_id = submission_versions.id AND r.status = 'published'
    )`)
  if (filter.status) query = query.where('submissions.status', '=', filter.status as 'submitted')
  if (filter.late !== undefined) query = query.where('submission_versions.is_late', '=', filter.late)
  if (filter.itemId) query = query.where('submissions.module_item_id', '=', filter.itemId)
  if (cursor) {
    query = query.where(
      sql<boolean>`(submission_versions.submitted_at, submission_versions.id) > (${cursor.at}::timestamptz, ${cursor.id}::uuid)`,
    )
  }
  const rows = await query.orderBy('submission_versions.submitted_at').orderBy('submission_versions.id').limit(filter.limit + 1).execute()
  const page = rows.slice(0, filter.limit)
  const last = page.at(-1)
  const next = rows.length > filter.limit && last
    ? Buffer.from(`${last.submittedAt.toISOString()}|${last.submissionVersionId}`).toString('base64url')
    : null
  return {
    items: page.map((row) => ({
      submissionId: row.submissionId,
      submissionVersionId: row.submissionVersionId,
      learnerId: row.learnerId,
      learnerName: row.learnerName,
      itemTitle: row.itemTitle,
      versionNo: row.versionNo,
      submittedAt: row.submittedAt.toISOString(),
      isLate: row.isLate,
      status: row.status,
    })),
    nextCursor: next,
  }
}

function decodeCursor(value: string | undefined): { at: string; id: string } | undefined {
  if (!value) return undefined
  const text = Buffer.from(value, 'base64url').toString('utf8')
  const split = text.indexOf('|')
  const at = text.slice(0, split)
  const id = text.slice(split + 1)
  if (!at || !id) throw new DomainError('VALIDATION_FAILED', { reason: 'CURSOR' })
  return { at, id }
}
