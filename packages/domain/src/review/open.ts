import { DomainError } from '../errors.ts'
import type { Db, Meta, Trx } from '../org/support.ts'
import { currentVersion, loadCriteria, loadRequirements, loadSubmission, requireReviewTeacher, scopedRequirementIds } from './load.ts'
import type { ReviewDraftDto } from './types.ts'

export async function openReview(db: Db, meta: Meta, submissionVersionId: string): Promise<ReviewDraftDto> {
  const version = await db
    .selectFrom('submission_versions')
    .select(['id', 'submission_id', 'version_no', 'submitted_at'])
    .where('id', '=', submissionVersionId)
    .executeTakeFirst()
  if (!version) throw new DomainError('NOT_FOUND')
  const context = await loadSubmission(db, meta.actor.schoolId, version.submission_id)
  await requireReviewTeacher(db, meta, context.offeringId)
  const existing = await db
    .selectFrom('reviews')
    .select(['id'])
    .where('submission_version_id', '=', version.id)
    .where('status', '=', 'draft')
    .executeTakeFirst()
  const reviewId = existing?.id ?? (await db
    .insertInto('reviews')
    .values({
      school_id: context.schoolId,
      submission_id: context.submissionId,
      submission_version_id: version.id,
      rubric_version_id: context.rubricVersionId,
      reviewer_id: meta.actor.userId,
      comment: null,
      outcome: null,
      published_at: null,
    })
    .returning('id')
    .executeTakeFirstOrThrow()).id
  return present(db, reviewId, context.submissionId, version.id)
}

export async function present(db: Db | Trx, reviewId: string, submissionId: string, submissionVersionId: string): Promise<ReviewDraftDto> {
  const review = await db
    .selectFrom('reviews')
    .select(['id', 'revision', 'comment', 'submission_version_id', 'rubric_version_id', 'school_id'])
    .where('id', '=', reviewId)
    .executeTakeFirst()
  if (!review) throw new DomainError('NOT_FOUND')
  const context = await loadSubmission(db, review.school_id, submissionId)
  const version = await db
    .selectFrom('submission_versions')
    .select(['id', 'version_no', 'submitted_at'])
    .where('id', '=', submissionVersionId)
    .executeTakeFirstOrThrow()
  const current = await currentVersion(db, submissionId, context.currentVersionNo)
  return {
    id: review.id,
    revision: review.revision,
    submissionId,
    submissionVersionId: review.submission_version_id,
    isCurrentVersion: current.id === review.submission_version_id,
    currentVersionId: current.id,
    currentSubmittedAt: current.submittedAt.toISOString(),
    learnerName: context.learnerName,
    itemTitle: context.itemTitle,
    versionNo: version.version_no,
    submittedAt: version.submitted_at.toISOString(),
    comment: review.comment,
    criteria: await loadCriteria(db, review.rubric_version_id, review.id),
    requirements: await loadRequirements(db, scopedRequirementIds(context)),
  }
}
