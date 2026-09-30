import type { Trx } from '../org/support.ts'

export type DecisionInsert = {
  schoolId: string
  learnerId: string
  offeringId: string
  requirementId: string
  decision: 'achieved' | 'not_yet'
  reviewId: string
  decidedBy: string
  reason: string | null
  supersedesId: string | null
}

/** Chỉ publishReview và supersedeDecision được gọi hàm này (INV-04). */
export async function insertAttainmentDecision(trx: Trx, row: DecisionInsert): Promise<{ id: string; decidedAt: Date }> {
  const created = await trx
    .insertInto('attainment_decisions')
    .values({
      school_id: row.schoolId,
      learner_id: row.learnerId,
      offering_id: row.offeringId,
      requirement_id: row.requirementId,
      decision: row.decision,
      review_id: row.reviewId,
      decided_by: row.decidedBy,
      reason: row.reason,
      supersedes_id: row.supersedesId,
    })
    .returning(['id', 'decided_at'])
    .executeTakeFirstOrThrow()
  return { id: created.id, decidedAt: created.decided_at }
}
