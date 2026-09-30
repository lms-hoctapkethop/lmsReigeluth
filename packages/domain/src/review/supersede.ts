import { DomainError } from '../errors.ts'
import { requestDigest } from '../authoring/digest.ts'
import { withIdempotency } from '../idempotency.ts'
import { authorize } from '../identity/policies.ts'
import { capabilities } from '../learning/gate.ts'
import { audit, outbox, pgCode, type Db, type Meta } from '../org/support.ts'
import { insertAttainmentDecision } from './decisions.ts'
import { loadSubmission, lockDecision } from './load.ts'
import type { DecisionDto } from './types.ts'

export async function supersedeDecision(
  db: Db,
  meta: Meta,
  decisionId: string,
  input: { decision: 'achieved' | 'not_yet'; reason: string; reviewId: string; idempotencyKey: string },
): Promise<DecisionDto> {
  if (input.reason.trim().length < 5) throw new DomainError('VALIDATION_FAILED', { reason: 'REASON' })
  return withIdempotency(db, meta, {
    scope: `supersedeDecision:${decisionId}`,
    key: input.idempotencyKey,
    requestHash: requestDigest({ decision: input.decision, reason: input.reason, reviewId: input.reviewId }),
    run: async (trx) => {
      const target = await trx
        .selectFrom('attainment_decisions')
        .select(['id', 'school_id', 'learner_id', 'offering_id', 'requirement_id'])
        .where('id', '=', decisionId)
        .executeTakeFirst()
      if (!target || target.school_id !== meta.actor.schoolId) throw new DomainError('NOT_FOUND')
      const caps = await capabilities(trx, meta, target.offering_id)
      if (!caps.includes('review')) throw new DomainError('NOT_FOUND')
      authorize(meta.actor, 'decision.supersede', { reviewAssigned: true })
      const current = await trx
        .selectFrom('attainment_current')
        .select('id')
        .where('id', '=', decisionId)
        .executeTakeFirst()
      if (!current) throw new DomainError('REVISION_CONFLICT', { reason: 'DECISION_CHANGED' })
      const review = await trx
        .selectFrom('reviews')
        .select(['id', 'status', 'submission_id'])
        .where('id', '=', input.reviewId)
        .where('school_id', '=', meta.actor.schoolId)
        .executeTakeFirst()
      if (!review || review.status !== 'published') throw new DomainError('VALIDATION_FAILED', { reason: 'REVIEW' })
      const context = await loadSubmission(trx, meta.actor.schoolId, review.submission_id)
      if (context.learnerId !== target.learner_id || context.offeringId !== target.offering_id) {
        throw new DomainError('VALIDATION_FAILED', { reason: 'REVIEW' })
      }
      await lockDecision(trx, target.learner_id, target.offering_id, target.requirement_id)
      try {
        const created = await insertAttainmentDecision(trx, {
          schoolId: target.school_id,
          learnerId: target.learner_id,
          offeringId: target.offering_id,
          requirementId: target.requirement_id,
          decision: input.decision,
          reviewId: review.id,
          decidedBy: meta.actor.userId,
          reason: input.reason,
          supersedesId: target.id,
        })
        await audit(trx, meta, {
          action: 'decision.supersede',
          objectType: 'attainment_decision',
          objectId: created.id,
          details: { supersedesId: target.id, reviewId: review.id },
        })
        await outbox(trx, {
          schoolId: target.school_id,
          aggregateType: 'attainment_decision',
          aggregateId: created.id,
          eventType: 'DecisionSuperseded',
          payload: {
            decisionId: created.id,
            learnerId: target.learner_id,
            offeringId: target.offering_id,
            title: context.itemTitle,
          },
        })
        return {
          id: created.id,
          requirementId: target.requirement_id,
          decision: input.decision,
          decidedAt: created.decidedAt.toISOString(),
          supersedesId: target.id,
        }
      } catch (error) {
        if (pgCode(error) === '23505') throw new DomainError('REVISION_CONFLICT', { reason: 'DECISION_CHANGED' })
        throw error
      }
    },
  })
}
