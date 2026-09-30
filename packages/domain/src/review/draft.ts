import { DomainError } from '../errors.ts'
import { revisionFrom } from '../authoring/draft.ts'
import type { Db, Meta } from '../org/support.ts'
import { loadSubmission, requireReviewTeacher } from './load.ts'
import { present } from './open.ts'
import type { CriterionLevel, ReviewDraftDto } from './types.ts'

const levels = new Set<CriterionLevel>(['meets', 'developing', 'not_yet', 'not_shown'])

export async function saveReviewDraft(
  db: Db,
  meta: Meta,
  reviewId: string,
  ifMatch: string | undefined,
  input: { comment: string | null; criteria: { criterionId: string; level: CriterionLevel | null; note: string | null }[] },
): Promise<ReviewDraftDto> {
  const expected = revisionFrom(ifMatch)
  return db.transaction().execute(async (trx) => {
    const review = await trx
      .selectFrom('reviews')
      .select(['id', 'school_id', 'submission_id', 'submission_version_id', 'rubric_version_id', 'status', 'revision'])
      .where('id', '=', reviewId)
      .forUpdate()
      .executeTakeFirst()
    if (!review || review.school_id !== meta.actor.schoolId) throw new DomainError('NOT_FOUND')
    const context = await loadSubmission(trx, meta.actor.schoolId, review.submission_id)
    await requireReviewTeacher(trx, meta, context.offeringId)
    if (review.status !== 'draft') throw new DomainError('ALREADY_PUBLISHED')
    if (review.revision !== expected) throw new DomainError('REVISION_CONFLICT')
    const allowed = new Set(
      review.rubric_version_id
        ? (await trx.selectFrom('rubric_criteria').select('id').where('rubric_version_id', '=', review.rubric_version_id).execute()).map((row) => row.id)
        : [],
    )
    for (const criterion of input.criteria) {
      if (!allowed.has(criterion.criterionId)) throw new DomainError('VALIDATION_FAILED', { reason: 'CRITERION' })
      if (criterion.level !== null && !levels.has(criterion.level)) throw new DomainError('VALIDATION_FAILED', { reason: 'LEVEL' })
    }
    await trx
      .updateTable('reviews')
      .set({ comment: input.comment, reviewer_id: meta.actor.userId, revision: review.revision + 1 })
      .where('id', '=', review.id)
      .execute()
    for (const criterion of input.criteria) {
      const level = criterion.level
      if (!level) {
        await trx.deleteFrom('review_criterion_results').where('review_id', '=', review.id).where('rubric_criterion_id', '=', criterion.criterionId).execute()
        continue
      }
      await trx
        .insertInto('review_criterion_results')
        .values({ review_id: review.id, rubric_criterion_id: criterion.criterionId, level, note: criterion.note })
        .onConflict((conflict) => conflict.columns(['review_id', 'rubric_criterion_id']).doUpdateSet({ level, note: criterion.note }))
        .execute()
    }
    return present(trx, review.id, review.submission_id, review.submission_version_id)
  })
}
