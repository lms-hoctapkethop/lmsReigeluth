import { DomainError } from '../errors.ts'
import { requestDigest } from '../authoring/digest.ts'
import { withIdempotency } from '../idempotency.ts'
import { authorize } from '../identity/policies.ts'
import { capabilities } from '../learning/gate.ts'
import { audit, outbox, pgCode, type Db, type Meta, type Trx } from '../org/support.ts'
import { insertAttainmentDecision } from './decisions.ts'
import { currentVersion, loadCriteria, loadSubmission, lockDecision, lockReview, lockSubmission, scopedRequirementIds } from './load.ts'
import type { DecisionDto, PublishedReviewDto } from './types.ts'

export type PublishInput = {
  expectedRevision: number
  expectedSubmissionVersionId: string
  outcome: 'reviewed' | 'changes_requested'
  decisions: { requirementId: string; decision: 'achieved' | 'not_yet'; reason: string }[]
  idempotencyKey: string
}

export async function publishReview(db: Db, meta: Meta, reviewId: string, input: PublishInput): Promise<PublishedReviewDto> {
  return withIdempotency(db, meta, {
    scope: `publishReview:${reviewId}`,
    key: input.idempotencyKey,
    requestHash: requestDigest({
      expectedRevision: input.expectedRevision,
      expectedSubmissionVersionId: input.expectedSubmissionVersionId,
      outcome: input.outcome,
      decisions: input.decisions,
    }),
    run: (trx) => publishInTransaction(trx, meta, reviewId, input),
  })
}

async function publishInTransaction(trx: Trx, meta: Meta, reviewId: string, input: PublishInput): Promise<PublishedReviewDto> {
  const review = await trx
    .selectFrom('reviews')
    .select(['id', 'school_id', 'submission_id', 'submission_version_id', 'rubric_version_id', 'status', 'revision', 'comment'])
    .where('id', '=', reviewId)
    .executeTakeFirst()
  if (!review || review.school_id !== meta.actor.schoolId) throw new DomainError('NOT_FOUND')
  const context = await loadSubmission(trx, meta.actor.schoolId, review.submission_id)
  const caps = await capabilities(trx, meta, context.offeringId)
  if (!caps.includes('review')) throw new DomainError('NOT_FOUND')
  authorize(meta.actor, 'review.*', { reviewAssigned: true })
  if (review.status === 'published') throw new DomainError('ALREADY_PUBLISHED')
  if (review.revision !== input.expectedRevision) throw new DomainError('REVISION_CONFLICT')
  const current = await currentVersion(trx, context.submissionId, context.currentVersionNo)
  if (input.expectedSubmissionVersionId !== review.submission_version_id || review.submission_version_id !== current.id) {
    throw new DomainError('SUBMISSION_VERSION_CHANGED', { currentSubmissionVersionId: current.id })
  }
  const criteria = await loadCriteria(trx, review.rubric_version_id, review.id)
  if (criteria.some((row) => row.level === null)) throw new DomainError('VALIDATION_FAILED', { reason: 'CRITERIA' })
  const allowed = new Set(scopedRequirementIds(context))
  const seen = new Set<string>()
  const ordered = [...input.decisions].sort((a, b) => a.requirementId.localeCompare(b.requirementId))
  for (const decision of ordered) {
    if (!allowed.has(decision.requirementId)) throw new DomainError('VALIDATION_FAILED', { reason: 'REQUIREMENT' })
    if (seen.has(decision.requirementId)) throw new DomainError('VALIDATION_FAILED', { reason: 'REQUIREMENT' })
    seen.add(decision.requirementId)
    if (decision.reason.trim().length < 3) throw new DomainError('VALIDATION_FAILED', { reason: 'REASON' })
  }
  const planned = []
  for (const decision of ordered) {
    const currentDecision = await trx
      .selectFrom('attainment_current')
      .select(['id'])
      .where('learner_id', '=', context.learnerId)
      .where('offering_id', '=', context.offeringId)
      .where('requirement_id', '=', decision.requirementId)
      .executeTakeFirst()
    planned.push({ ...decision, supersedesId: currentDecision?.id ?? null })
  }
  await lockSubmission(trx, context.submissionId)
  await lockReview(trx, review.id)
  for (const decision of planned) await lockDecision(trx, context.learnerId, context.offeringId, decision.requirementId)
  const publishedAt = meta.clock.now()
  await trx
    .updateTable('reviews')
    .set({ status: 'published', outcome: input.outcome, published_at: publishedAt, reviewer_id: meta.actor.userId })
    .where('id', '=', review.id)
    .where('status', '=', 'draft')
    .execute()
  await trx.updateTable('submissions').set({ status: input.outcome }).where('id', '=', context.submissionId).execute()
  const decisions: DecisionDto[] = []
  for (const decision of planned) {
    const currentDecision = await trx
      .selectFrom('attainment_current')
      .select(['id'])
      .where('learner_id', '=', context.learnerId)
      .where('offering_id', '=', context.offeringId)
      .where('requirement_id', '=', decision.requirementId)
      .executeTakeFirst()
    const nowId = currentDecision?.id ?? null
    if (nowId !== decision.supersedesId) throw new DomainError('REVISION_CONFLICT', { reason: 'DECISION_CHANGED' })
    try {
      const created = await insertAttainmentDecision(trx, {
        schoolId: context.schoolId,
        learnerId: context.learnerId,
        offeringId: context.offeringId,
        requirementId: decision.requirementId,
        decision: decision.decision,
        reviewId: review.id,
        decidedBy: meta.actor.userId,
        reason: decision.reason,
        supersedesId: decision.supersedesId,
      })
      decisions.push({
        id: created.id,
        requirementId: decision.requirementId,
        decision: decision.decision,
        decidedAt: created.decidedAt.toISOString(),
        supersedesId: decision.supersedesId,
      })
    } catch (error) {
      if (pgCode(error) === '23505') throw new DomainError('REVISION_CONFLICT', { reason: 'DECISION_CHANGED' })
      throw error
    }
  }
  await audit(trx, meta, {
    action: 'review.publish',
    objectType: 'review',
    objectId: review.id,
    details: { outcome: input.outcome, submissionVersionId: review.submission_version_id, decisionCount: String(decisions.length) },
  })
  await outbox(trx, {
    schoolId: context.schoolId,
    aggregateType: 'review',
    aggregateId: review.id,
    eventType: 'ReviewPublished',
    payload: {
      reviewId: review.id,
      learnerId: context.learnerId,
      offeringId: context.offeringId,
      title: context.itemTitle,
    },
  })
  return {
    id: review.id,
    submissionVersionId: review.submission_version_id,
    publishedAt: publishedAt.toISOString(),
    outcome: input.outcome,
    comment: review.comment,
    criteria,
    decisions,
  }
}
