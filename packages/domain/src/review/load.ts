import { sql } from 'kysely'
import { DomainError } from '../errors.ts'
import { authorize } from '../identity/policies.ts'
import { capabilities } from '../learning/gate.ts'
import type { Db, Meta, Trx } from '../org/support.ts'
import type { CriterionDto, RequirementDto } from './types.ts'

type DbLike = Db | Trx

export type SubmissionContext = {
  submissionId: string
  schoolId: string
  learnerId: string
  learnerName: string
  offeringId: string
  releaseId: string
  itemId: string
  itemTitle: string
  moduleVersionId: string
  rubricVersionId: string | null
  itemRequirementIds: string[]
  moduleRequirementIds: string[]
  status: 'draft' | 'submitted' | 'changes_requested' | 'reviewed'
  currentVersionNo: number
}

export async function requireReviewTeacher(db: DbLike, meta: Meta, offeringId: string): Promise<void> {
  const caps = await capabilities(db, meta, offeringId)
  if (!caps.includes('review')) throw new DomainError('NOT_FOUND')
  authorize(meta.actor, 'review.*', { reviewAssigned: true })
}

export async function loadSubmission(db: DbLike, schoolId: string, submissionId: string): Promise<SubmissionContext> {
  const row = await db
    .selectFrom('submissions')
    .innerJoin('module_releases', 'module_releases.id', 'submissions.module_release_id')
    .innerJoin('module_items', 'module_items.id', 'submissions.module_item_id')
    .innerJoin('module_versions', 'module_versions.id', 'module_releases.module_version_id')
    .innerJoin('users', 'users.id', 'submissions.learner_id')
    .select([
      'submissions.id as submissionId',
      'submissions.school_id as schoolId',
      'submissions.learner_id as learnerId',
      'submissions.status as status',
      'submissions.current_version_no as currentVersionNo',
      'users.display_name as learnerName',
      'module_releases.offering_id as offeringId',
      'module_releases.id as releaseId',
      'module_releases.module_version_id as moduleVersionId',
      'module_items.id as itemId',
      'module_items.title as itemTitle',
      'module_items.rubric_version_id as rubricVersionId',
      'module_items.requirement_ids as itemRequirementIds',
      'module_versions.requirement_ids as moduleRequirementIds',
    ])
    .where('submissions.id', '=', submissionId)
    .executeTakeFirst()
  if (!row || row.schoolId !== schoolId) throw new DomainError('NOT_FOUND')
  return row
}

export async function currentVersion(db: DbLike, submissionId: string, versionNo: number): Promise<{ id: string; submittedAt: Date; versionNo: number; isLate: boolean }> {
  const row = await db
    .selectFrom('submission_versions')
    .select(['id', 'submitted_at as submittedAt', 'version_no as versionNo', 'is_late as isLate'])
    .where('submission_id', '=', submissionId)
    .where('version_no', '=', versionNo)
    .executeTakeFirst()
  if (!row) throw new DomainError('NOT_FOUND')
  return row
}

export function scopedRequirementIds(context: SubmissionContext): string[] {
  return context.itemRequirementIds.length > 0 ? context.itemRequirementIds : context.moduleRequirementIds
}

export async function loadRequirements(db: DbLike, ids: string[]): Promise<RequirementDto[]> {
  if (ids.length === 0) return []
  const rows = await db
    .selectFrom('curriculum_requirements')
    .select(['id', 'code791_stem', 'bloom_level', 'subject_code', 'grade', 'text', 'orientation', 'review_status', 'extraction'])
    .where('id', 'in', ids)
    .execute()
  const byId = new Map(rows.map((row) => [row.id, row]))
  return ids.flatMap((id) => {
    const row = byId.get(id)
    if (!row) return []
    return [{
      id: row.id,
      code791Stem: row.code791_stem,
      bloomLevel: row.bloom_level,
      subjectCode: row.subject_code,
      grade: row.grade,
      text: row.text,
      orientation: row.orientation,
      reviewStatus: row.review_status,
      extraction: row.extraction,
    }]
  })
}

export async function loadCriteria(db: DbLike, rubricVersionId: string | null, reviewId: string | null): Promise<CriterionDto[]> {
  if (!rubricVersionId) return []
  const criteria = await db
    .selectFrom('rubric_criteria')
    .select(['id', 'title', 'position', 'level_meets', 'level_developing', 'level_not_yet'])
    .where('rubric_version_id', '=', rubricVersionId)
    .orderBy('position')
    .execute()
  const results = reviewId
    ? await db
        .selectFrom('review_criterion_results')
        .select(['rubric_criterion_id', 'level', 'note'])
        .where('review_id', '=', reviewId)
        .execute()
    : []
  const byCriterion = new Map(results.map((row) => [row.rubric_criterion_id, row]))
  return criteria.map((row) => {
    const saved = byCriterion.get(row.id)
    return {
      criterionId: row.id,
      title: row.title,
      level: saved?.level ?? null,
      note: saved?.note ?? null,
      levels: { meets: row.level_meets, developing: row.level_developing, notYet: row.level_not_yet },
    }
  })
}

export async function lockSubmission(db: Trx, id: string): Promise<void> {
  await sql`SELECT id FROM submissions WHERE id = ${id}::uuid FOR UPDATE`.execute(db)
}

export async function lockReview(db: Trx, id: string): Promise<void> {
  await sql`SELECT id FROM reviews WHERE id = ${id}::uuid FOR UPDATE`.execute(db)
}

export async function lockDecision(db: Trx, learnerId: string, offeringId: string, requirementId: string): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${learnerId} || ${offeringId} || ${requirementId}, 0))`.execute(db)
}
