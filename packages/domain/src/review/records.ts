import { DomainError } from '../errors.ts'
import { authorize } from '../identity/policies.ts'
import { activeEnrollment, capabilities } from '../learning/gate.ts'
import type { Db, Meta } from '../org/support.ts'
import type { DecisionDto } from './types.ts'

export type LearnerRecords = {
  offeringId: string
  activity: { completed: number; required: number; updatedAt: string | null }
  requirements: {
    requirement: { id: string; code791Stem: string; text: string }
    currentDecision: DecisionDto | null
    history: DecisionDto[]
    evidence: { reviewId: string; submissionVersionId: string; publishedAt: string }[]
  }[]
  lastUpdatedAt: string
}

export async function getLearnerRecords(db: Db, meta: Meta, learnerId: string, offeringId: string): Promise<LearnerRecords> {
  const offering = await db.selectFrom('offerings').select(['id', 'school_id']).where('id', '=', offeringId).executeTakeFirst()
  if (!offering || offering.school_id !== meta.actor.schoolId) throw new DomainError('NOT_FOUND')
  const role = meta.actor.roles[0]
  if (role === 'student') {
    if (learnerId !== meta.actor.userId) throw new DomainError('NOT_FOUND')
    const enrolled = await activeEnrollment(db, meta, offeringId)
    if (!enrolled) throw new DomainError('NOT_FOUND')
    authorize(meta.actor, 'review.read_published', { enrolled: true })
  } else if (role === 'teacher') {
    const caps = await capabilities(db, meta, offeringId)
    if (caps.length === 0) throw new DomainError('NOT_FOUND')
    authorize(meta.actor, 'review.read_published', { teacherAssigned: true })
  } else if (role === 'guardian') {
    const link = await verifiedLink(db, meta, learnerId)
    if (!link) throw new DomainError('NOT_FOUND')
    authorize(meta.actor, 'review.read_published', { guardianLinked: true })
  } else throw new DomainError('NOT_FOUND')
  const enrolled = await db
    .selectFrom('offering_enrollments')
    .select('id')
    .where('offering_id', '=', offeringId)
    .where('learner_id', '=', learnerId)
    .where('school_id', '=', meta.actor.schoolId)
    .where('status', '=', 'active')
    .executeTakeFirst()
  if (!enrolled && role !== 'teacher') throw new DomainError('NOT_FOUND')

  const items = await db
    .selectFrom('module_releases')
    .innerJoin('module_items', 'module_items.module_version_id', 'module_releases.module_version_id')
    .innerJoin('module_versions', 'module_versions.id', 'module_releases.module_version_id')
    .select([
      'module_releases.id as releaseId',
      'module_items.id as itemId',
      'module_items.completion_rule as completion',
      'module_items.requirement_ids as itemRequirements',
      'module_versions.requirement_ids as moduleRequirements',
    ])
    .where('module_releases.offering_id', '=', offeringId)
    .where('module_releases.school_id', '=', meta.actor.schoolId)
    .execute()
  const requiredItems = items.filter((item) => item.completion !== 'none')
  const progress = requiredItems.length
    ? await db
        .selectFrom('activity_progress')
        .select(['module_release_id', 'module_item_id', 'status', 'updated_at'])
        .where('learner_id', '=', learnerId)
        .where('school_id', '=', meta.actor.schoolId)
        .where('module_release_id', 'in', [...new Set(requiredItems.map((item) => item.releaseId))])
        .execute()
    : []
  const progressKey = new Set(progress.filter((row) => row.status === 'completed').map((row) => `${row.module_release_id}:${row.module_item_id}`))
  const completed = requiredItems.filter((item) => progressKey.has(`${item.releaseId}:${item.itemId}`)).length
  const activityUpdated = progress.reduce<Date | null>((latest, row) => (!latest || row.updated_at > latest ? row.updated_at : latest), null)

  const requirementIds = [...new Set(items.flatMap((item) => (item.itemRequirements.length > 0 ? item.itemRequirements : item.moduleRequirements)))]
  const requirements = requirementIds.length
    ? await db
        .selectFrom('curriculum_requirements')
        .select(['id', 'code791_stem', 'text'])
        .where('id', 'in', requirementIds)
        .orderBy('code791_stem')
        .execute()
    : []
  const decisions = await db
    .selectFrom('attainment_decisions')
    .select(['id', 'requirement_id', 'decision', 'decided_at', 'supersedes_id', 'review_id'])
    .where('learner_id', '=', learnerId)
    .where('offering_id', '=', offeringId)
    .where('school_id', '=', meta.actor.schoolId)
    .orderBy('decided_at')
    .execute()
  const currentIds = new Set(
    (decisions.length
      ? await db.selectFrom('attainment_current').select('id').where('learner_id', '=', learnerId).where('offering_id', '=', offeringId).execute()
      : []
    ).map((row) => row.id),
  )
  const reviews = await db
    .selectFrom('reviews')
    .innerJoin('submissions', 'submissions.id', 'reviews.submission_id')
    .innerJoin('module_releases', 'module_releases.id', 'submissions.module_release_id')
    .innerJoin('module_items', 'module_items.id', 'submissions.module_item_id')
    .innerJoin('module_versions', 'module_versions.id', 'module_releases.module_version_id')
    .select([
      'reviews.id as reviewId',
      'reviews.submission_version_id as submissionVersionId',
      'reviews.published_at as publishedAt',
      'module_items.requirement_ids as itemRequirements',
      'module_versions.requirement_ids as moduleRequirements',
    ])
    .where('reviews.status', '=', 'published')
    .where('submissions.learner_id', '=', learnerId)
    .where('module_releases.offering_id', '=', offeringId)
    .execute()
  let last = activityUpdated
  const layers = requirements.map((requirement) => {
    const history = decisions.filter((row) => row.requirement_id === requirement.id).map(toDecision)
    const current = history.find((row) => currentIds.has(row.id)) ?? null
    for (const row of history) {
      const at = new Date(row.decidedAt)
      if (!last || at > last) last = at
    }
    const evidence = reviews
      .filter((review) => {
        const ids = review.itemRequirements.length > 0 ? review.itemRequirements : review.moduleRequirements
        return ids.includes(requirement.id)
      })
      .flatMap((review) => {
        if (!review.publishedAt) return []
        if (!last || review.publishedAt > last) last = review.publishedAt
        return [{ reviewId: review.reviewId, submissionVersionId: review.submissionVersionId, publishedAt: review.publishedAt.toISOString() }]
      })
    return { requirement: { id: requirement.id, code791Stem: requirement.code791_stem, text: requirement.text }, currentDecision: current, history, evidence }
  })
  return {
    offeringId,
    activity: { completed, required: requiredItems.length, updatedAt: activityUpdated ? activityUpdated.toISOString() : null },
    requirements: layers,
    lastUpdatedAt: (last ?? meta.clock.now()).toISOString(),
  }
}

function toDecision(row: { id: string; requirement_id: string; decision: 'achieved' | 'not_yet'; decided_at: Date; supersedes_id: string | null }): DecisionDto {
  return {
    id: row.id,
    requirementId: row.requirement_id,
    decision: row.decision,
    decidedAt: row.decided_at.toISOString(),
    supersedesId: row.supersedes_id,
  }
}

async function verifiedLink(db: Db, meta: Meta, learnerId: string): Promise<boolean> {
  const link = await db
    .selectFrom('guardian_links')
    .select('id')
    .where('guardian_id', '=', meta.actor.userId)
    .where('learner_id', '=', learnerId)
    .where('school_id', '=', meta.actor.schoolId)
    .where('status', '=', 'verified')
    .executeTakeFirst()
  return Boolean(link)
}
