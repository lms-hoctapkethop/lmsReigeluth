import { DomainError } from '../errors.ts'
import { authorize } from '../identity/policies.ts'
import type { Db, Meta } from '../org/support.ts'
import type { PublishedReviewDto } from './types.ts'

export type GuardianOverview = {
  learnerId: string
  offerings: {
    offeringId: string
    title: string
    activity: { completed: number; required: number }
    achievedRequirements: number
    totalRequirements: number
    publishedFeedback: PublishedReviewDto[]
    upcoming: { title: string; dueAt: string; href: string }[]
  }[]
  supports: { id: string; content: string; status: string; createdAt: string }[]
}

type Source = {
  learnerId: string
  offerings: {
    offeringId: string
    title: string
    activity: { completed: number; required: number }
    achievedRequirements: number
    totalRequirements: number
    publishedFeedback: PublishedReviewDto[]
    upcoming: { title: string; dueAt: string; href: string }[]
  }[]
  supports: { id: string; content: string; status: string; createdAt: string }[]
}

/** Hàm chiếu duy nhất cho DTO phụ huynh. Không nhận nháp, nội dung bài, hay needs. */
export function toGuardianChildOverview(source: Source): GuardianOverview {
  return {
    learnerId: source.learnerId,
    offerings: source.offerings.map((offering) => ({
      offeringId: offering.offeringId,
      title: offering.title,
      activity: { completed: offering.activity.completed, required: offering.activity.required },
      achievedRequirements: offering.achievedRequirements,
      totalRequirements: offering.totalRequirements,
      publishedFeedback: offering.publishedFeedback.map((review) => ({
        id: review.id,
        submissionVersionId: review.submissionVersionId,
        publishedAt: review.publishedAt,
        outcome: review.outcome,
        comment: review.comment,
        criteria: review.criteria.map((criterion) => ({
          criterionId: criterion.criterionId,
          title: criterion.title,
          level: criterion.level,
          note: criterion.note,
          levels: criterion.levels,
        })),
        decisions: review.decisions.map((decision) => ({
          id: decision.id,
          requirementId: decision.requirementId,
          decision: decision.decision,
          decidedAt: decision.decidedAt,
          supersedesId: decision.supersedesId,
        })),
      })),
      upcoming: offering.upcoming.map((item) => ({ title: item.title, dueAt: item.dueAt, href: item.href })),
    })),
    supports: source.supports.map((support) => ({
      id: support.id,
      content: support.content,
      status: support.status,
      createdAt: support.createdAt,
    })),
  }
}

export async function getChildOverview(db: Db, meta: Meta, learnerId: string): Promise<GuardianOverview> {
  if (!meta.actor.roles.includes('guardian')) throw new DomainError('NOT_FOUND')
  const link = await db
    .selectFrom('guardian_links')
    .select(['id', 'school_id'])
    .where('guardian_id', '=', meta.actor.userId)
    .where('learner_id', '=', learnerId)
    .where('status', '=', 'verified')
    .executeTakeFirst()
  if (!link || link.school_id !== meta.actor.schoolId) throw new DomainError('NOT_FOUND')
  authorize(meta.actor, 'family_support.*', { guardianLinked: true })
  const offerings = await db
    .selectFrom('offering_enrollments')
    .innerJoin('offerings', 'offerings.id', 'offering_enrollments.offering_id')
    .select(['offerings.id as offeringId', 'offerings.title as title'])
    .where('offering_enrollments.learner_id', '=', learnerId)
    .where('offering_enrollments.status', '=', 'active')
    .where('offerings.school_id', '=', meta.actor.schoolId)
    .orderBy('offerings.title')
    .execute()
  const now = meta.clock.now()
  const built = []
  for (const offering of offerings) {
    const items = await db
      .selectFrom('module_releases')
      .innerJoin('module_items', 'module_items.module_version_id', 'module_releases.module_version_id')
      .innerJoin('module_versions', 'module_versions.id', 'module_releases.module_version_id')
      .select([
        'module_releases.id as releaseId',
        'module_releases.due_at as dueAt',
        'module_items.id as itemId',
        'module_items.title as title',
        'module_items.completion_rule as completion',
        'module_items.requirement_ids as itemRequirements',
        'module_versions.requirement_ids as moduleRequirements',
      ])
      .where('module_releases.offering_id', '=', offering.offeringId)
      .execute()
    const required = items.filter((item) => item.completion !== 'none')
    const progress = required.length
      ? await db
          .selectFrom('activity_progress')
          .select(['module_release_id', 'module_item_id', 'status'])
          .where('learner_id', '=', learnerId)
          .where('status', '=', 'completed')
          .where('module_release_id', 'in', [...new Set(required.map((item) => item.releaseId))])
          .execute()
      : []
    const done = new Set(progress.map((row) => `${row.module_release_id}:${row.module_item_id}`))
    const requirementIds = [...new Set(items.flatMap((item) => (item.itemRequirements.length > 0 ? item.itemRequirements : item.moduleRequirements)))]
    const achieved = requirementIds.length
      ? await db
          .selectFrom('attainment_current')
          .select('id')
          .where('learner_id', '=', learnerId)
          .where('offering_id', '=', offering.offeringId)
          .where('decision', '=', 'achieved')
          .where('requirement_id', 'in', requirementIds)
          .execute()
      : []
    const reviews = await db
      .selectFrom('reviews')
      .innerJoin('submissions', 'submissions.id', 'reviews.submission_id')
      .innerJoin('module_releases', 'module_releases.id', 'submissions.module_release_id')
      .select(['reviews.id', 'reviews.submission_version_id', 'reviews.published_at', 'reviews.outcome', 'reviews.comment', 'reviews.rubric_version_id'])
      .where('reviews.status', '=', 'published')
      .where('submissions.learner_id', '=', learnerId)
      .where('module_releases.offering_id', '=', offering.offeringId)
      .orderBy('reviews.published_at', 'desc')
      .execute()
    const publishedFeedback: PublishedReviewDto[] = []
    for (const review of reviews) {
      if (!review.published_at || !review.outcome) continue
      const criteria = review.rubric_version_id
        ? await db
            .selectFrom('review_criterion_results')
            .innerJoin('rubric_criteria', 'rubric_criteria.id', 'review_criterion_results.rubric_criterion_id')
            .select(['rubric_criteria.id as criterionId', 'rubric_criteria.title as title', 'review_criterion_results.level as level', 'review_criterion_results.note as note', 'rubric_criteria.level_meets as meets', 'rubric_criteria.level_developing as developing', 'rubric_criteria.level_not_yet as notYet'])
            .where('review_criterion_results.review_id', '=', review.id)
            .execute()
        : []
      const decisions = await db
        .selectFrom('attainment_decisions')
        .select(['id', 'requirement_id', 'decision', 'decided_at', 'supersedes_id'])
        .where('review_id', '=', review.id)
        .execute()
      publishedFeedback.push({
        id: review.id,
        submissionVersionId: review.submission_version_id,
        publishedAt: review.published_at.toISOString(),
        outcome: review.outcome,
        comment: review.comment,
        criteria: criteria.map((row) => ({
          criterionId: row.criterionId,
          title: row.title,
          level: row.level,
          note: row.note,
          levels: { meets: row.meets, developing: row.developing, notYet: row.notYet },
        })),
        decisions: decisions.map((row) => ({
          id: row.id,
          requirementId: row.requirement_id,
          decision: row.decision,
          decidedAt: row.decided_at.toISOString(),
          supersedesId: row.supersedes_id,
        })),
      })
    }
    const submitted = await db
      .selectFrom('submissions')
      .select(['module_release_id', 'module_item_id', 'current_version_no'])
      .where('learner_id', '=', learnerId)
      .where('current_version_no', '>', 0)
      .execute()
    const submittedKeys = new Set(submitted.map((row) => `${row.module_release_id}:${row.module_item_id}`))
    const upcoming = items.flatMap((item) => {
      if (item.completion !== 'submit' || !item.dueAt || item.dueAt.getTime() <= now.getTime()) return []
      if (submittedKeys.has(`${item.releaseId}:${item.itemId}`)) return []
      return [{ title: item.title, dueAt: item.dueAt.toISOString(), href: `/hoc/bai/${item.releaseId}/muc/${item.itemId}` }]
    })
    built.push({
      offeringId: offering.offeringId,
      title: offering.title,
      activity: { completed: required.filter((item) => done.has(`${item.releaseId}:${item.itemId}`)).length, required: required.length },
      achievedRequirements: achieved.length,
      totalRequirements: requirementIds.length,
      publishedFeedback,
      upcoming,
    })
  }
  const supports = await db
    .selectFrom('family_supports')
    .select(['id', 'content', 'status', 'created_at'])
    .where('guardian_link_id', '=', link.id)
    .orderBy('created_at', 'desc')
    .execute()
  return toGuardianChildOverview({
    learnerId,
    offerings: built,
    supports: supports.map((row) => ({ id: row.id, content: row.content, status: row.status, createdAt: row.created_at.toISOString() })),
  })
}
