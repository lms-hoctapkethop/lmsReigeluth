import { sql } from 'kysely'
import { submissionBodyInput, type SubmissionBodyInput } from '@hcn/contracts'
import { requestDigest } from '../authoring/digest.ts'
import { revisionFrom } from '../authoring/draft.ts'
import { DomainError } from '../errors.ts'
import { withIdempotency } from '../idempotency.ts'
import { authorize } from '../identity/policies.ts'
import { asJson } from '../json.ts'
import { toLearnerRelease } from './projection.ts'
import { audit, outbox, type Db, type Meta, type Trx } from '../org/support.ts'
import {
  appliedSubmission,
  assertSubmitOpen,
  capabilities,
  guardianOfEnrolled,
  learnerRelease,
  loadRelease,
  opened,
  requireStudentAction,
  type ReleaseRow,
} from './gate.ts'

type ItemRow = {
  id: string
  position: number
  item_type: 'header' | 'page' | 'assignment' | 'quiz' | 'link'
  indent: number
  title: string
  body: unknown | null
  url: string | null
  completion_rule: string
  rubric_version_id: string | null
  submission_config: unknown | null
}

export async function getLearnerToday(db: Db, meta: Meta): Promise<{
  items: {
    releaseId: string
    itemId: string
    offeringId: string
    offeringTitle: string
    title: string
    itemType: 'page' | 'assignment' | 'quiz' | 'link'
    purpose: string | null
    dueAt: string | null
    status: string
  }[]
  newFeedback: number
}> {
  if (!meta.actor.roles.includes('student')) throw new DomainError('NOT_FOUND')
  const now = meta.clock.now()
  const rows = await db
    .selectFrom('module_releases')
    .innerJoin('offering_enrollments', 'offering_enrollments.offering_id', 'module_releases.offering_id')
    .innerJoin('offerings', 'offerings.id', 'module_releases.offering_id')
    .innerJoin('module_items', 'module_items.module_version_id', 'module_releases.module_version_id')
    .leftJoin('activity_progress', (join) =>
      join
        .onRef('activity_progress.module_item_id', '=', 'module_items.id')
        .onRef('activity_progress.module_release_id', '=', 'module_releases.id')
        .on('activity_progress.learner_id', '=', meta.actor.userId),
    )
    .leftJoin('submissions', (join) =>
      join
        .onRef('submissions.module_item_id', '=', 'module_items.id')
        .onRef('submissions.module_release_id', '=', 'module_releases.id')
        .on('submissions.learner_id', '=', meta.actor.userId),
    )
    .leftJoin('assessment_versions', 'assessment_versions.module_item_id', 'module_items.id')
    .select([
      'module_releases.id as releaseId',
      'module_items.id as itemId',
      'offerings.id as offeringId',
      'offerings.title as offeringTitle',
      'module_items.title as title',
      'module_items.item_type as itemType',
      'assessment_versions.purpose as purpose',
      'module_releases.due_at as dueAt',
      'activity_progress.status as progressStatus',
      'submissions.status as submissionStatus',
      'submissions.draft_revision as draftRevision',
    ])
    .where('offering_enrollments.learner_id', '=', meta.actor.userId)
    .where('offering_enrollments.status', '=', 'active')
    .where('module_releases.school_id', '=', meta.actor.schoolId)
    .where('module_releases.available_from', '<=', now)
    .where('module_items.item_type', '!=', 'header')
    .execute()
  const items = rows
    .map((row) => {
      const status = todayStatus(row.submissionStatus, row.progressStatus, row.draftRevision)
      return {
        releaseId: row.releaseId,
        itemId: row.itemId,
        offeringId: row.offeringId,
        offeringTitle: row.offeringTitle,
        title: row.title,
        itemType: row.itemType as 'page' | 'assignment' | 'quiz' | 'link',
        purpose: row.purpose,
        dueAt: row.dueAt ? row.dueAt.toISOString() : null,
        status,
      }
    })
    .filter((row) => row.status === 'not_started' || row.status === 'in_progress' || row.status === 'changes_requested')
    .sort((a, b) => {
      if (a.dueAt === b.dueAt) return a.title.localeCompare(b.title, 'vi')
      if (!a.dueAt) return 1
      if (!b.dueAt) return -1
      return a.dueAt.localeCompare(b.dueAt)
    })
  const feedback = await db
    .selectFrom('reviews')
    .innerJoin('submissions', 'submissions.id', 'reviews.submission_id')
    .select(sql<number>`count(*)::int`.as('n'))
    .where('submissions.learner_id', '=', meta.actor.userId)
    .where('reviews.status', '=', 'published')
    .executeTakeFirst()
  return { items, newFeedback: feedback?.n ?? 0 }
}

function todayStatus(submission: string | null, progress: string | null, draftRevision: number | null): string {
  if (submission === 'changes_requested') return 'changes_requested'
  if (submission === 'reviewed') return 'reviewed'
  if (submission === 'submitted') return 'submitted'
  if (progress === 'completed') return 'completed'
  if (progress === 'in_progress' || (draftRevision ?? 0) > 0) return 'in_progress'
  return 'not_started'
}

export async function getReleaseForLearner(db: Db, meta: Meta, releaseId: string): Promise<Record<string, unknown>> {
  const release = await loadRelease(db, meta.actor.schoolId, releaseId)
  const role = meta.actor.roles[0]
  if (role === 'student') await learnerRelease(db, meta, release)
  else if (role === 'teacher') {
    const caps = await capabilities(db, meta, release.offering_id)
    if (caps.length === 0) throw new DomainError('NOT_FOUND')
    authorize(meta.actor, 'release.read_learner', { teacherAssigned: true })
  } else if (role === 'guardian') {
    if (!opened(release, meta.clock.now())) throw new DomainError('NOT_FOUND')
    const linked = await guardianOfEnrolled(db, meta, release.offering_id)
    if (!linked) throw new DomainError('NOT_FOUND')
    authorize(meta.actor, 'release.read_learner', { guardianLinked: true })
  } else throw new DomainError('NOT_FOUND')
  const items = await db
    .selectFrom('module_items')
    .select(['id', 'position', 'item_type', 'indent', 'title', 'body', 'url', 'completion_rule', 'rubric_version_id', 'submission_config'])
    .where('module_version_id', '=', release.module_version_id)
    .orderBy('position')
    .execute()
  const rubricIds = items.flatMap((item) => (item.rubric_version_id ? [item.rubric_version_id] : []))
  const criteria = rubricIds.length === 0
    ? []
    : await db
        .selectFrom('rubric_criteria')
        .select(['rubric_version_id', 'position', 'title', 'level_meets', 'level_developing', 'level_not_yet'])
        .where('rubric_version_id', 'in', rubricIds)
        .orderBy('position')
        .execute()
  const questions = await db
    .selectFrom('question_items')
    .innerJoin('assessment_versions', 'assessment_versions.id', 'question_items.assessment_version_id')
    .select([
      'question_items.id',
      'question_items.position',
      'question_items.qtype',
      'question_items.stem',
      'question_items.options',
      'question_items.bloom_target',
      'question_items.hints',
      'assessment_versions.module_item_id',
      'assessment_versions.purpose',
    ])
    .where('assessment_versions.module_version_id', '=', release.module_version_id)
    .orderBy('question_items.position')
    .execute()
  const progressRows = role === 'student'
    ? await db
        .selectFrom('activity_progress')
        .select(['module_item_id', 'status', 'completed_at'])
        .where('learner_id', '=', meta.actor.userId)
        .where('module_release_id', '=', release.id)
        .execute()
    : []
  const draftShape = {
    title: release.title,
    items: items.map((item) => ({
      type: item.item_type,
      title: item.title,
      assessment: item.item_type === 'quiz'
        ? {
            purpose: questions.find((question) => question.module_item_id === item.id)?.purpose ?? null,
            questions: questions
              .filter((question) => question.module_item_id === item.id)
              .map((question) => ({
                id: question.id,
                qtype: question.qtype,
                stem: question.stem,
                options: question.options,
                bloomTarget: question.bloom_target,
                hintsAvailable: Array.isArray(question.hints) ? question.hints.length : 0,
              })),
          }
        : undefined,
    })),
  }
  const projected = toLearnerRelease(draftShape)
  const projectedItems = Array.isArray(projected.items) ? projected.items : []
  return {
    releaseId: release.id,
    offeringId: release.offering_id,
    title: release.title,
    dueAt: release.due_at ? release.due_at.toISOString() : null,
    acceptUntil: release.accept_until ? release.accept_until.toISOString() : null,
    latePolicy: release.late_policy,
    scheduleRevision: release.schedule_revision,
    requirements: [],
    items: items.map((item, index) => {
      const projectedItem = projectedItems[index] as { assessment?: { questions?: unknown[]; purpose?: string | null } } | undefined
      const progress = progressRows.find((row) => row.module_item_id === item.id)
      return {
        id: item.id,
        itemType: item.item_type,
        title: item.title,
        indent: item.indent,
        body: item.body,
        url: item.url,
        completionRule: item.completion_rule,
        purpose: projectedItem?.assessment?.purpose ?? null,
        rubric: rubricOf(item, criteria),
        submission: item.item_type === 'assignment' ? appliedSubmission(item.submission_config) : null,
        progress: {
          status: progress?.status === 'completed' ? 'completed' : progress ? 'in_progress' : 'not_started',
          completedAt: progress?.completed_at ? progress.completed_at.toISOString() : null,
        },
      }
    }),
  }
}

function rubricOf(
  item: ItemRow,
  criteria: { rubric_version_id: string; title: string; level_meets: string; level_developing: string; level_not_yet: string }[],
): { criteria: { title: string; meets: string; developing: string; notYet: string }[] } | null {
  if (!item.rubric_version_id) return null
  const rows = criteria.filter((row) => row.rubric_version_id === item.rubric_version_id)
  if (rows.length === 0) return null
  return {
    criteria: rows.map((row) => ({
      title: row.title,
      meets: row.level_meets,
      developing: row.level_developing,
      notYet: row.level_not_yet,
    })),
  }
}

async function assignmentItem(db: Db | Trx, release: ReleaseRow, itemId: string): Promise<ItemRow> {
  const item = await db
    .selectFrom('module_items')
    .select(['id', 'position', 'item_type', 'indent', 'title', 'body', 'url', 'completion_rule', 'rubric_version_id', 'submission_config'])
    .where('id', '=', itemId)
    .where('module_version_id', '=', release.module_version_id)
    .executeTakeFirst()
  if (!item) throw new DomainError('NOT_FOUND')
  return item
}

export async function markViewed(db: Db, meta: Meta, releaseId: string, itemId: string): Promise<{ status: string; completedAt: string | null }> {
  return completeItem(db, meta, releaseId, itemId, 'view', 'page_view')
}

export async function selfMark(db: Db, meta: Meta, releaseId: string, itemId: string): Promise<{ status: string; completedAt: string | null }> {
  return completeItem(db, meta, releaseId, itemId, 'self_mark', 'self_mark')
}

async function completeItem(
  db: Db,
  meta: Meta,
  releaseId: string,
  itemId: string,
  rule: 'view' | 'self_mark',
  source: string,
): Promise<{ status: string; completedAt: string | null }> {
  const release = await loadRelease(db, meta.actor.schoolId, releaseId)
  await requireStudentAction(db, meta, release, 'progress.write')
  const item = await assignmentItem(db, release, itemId)
  if (item.completion_rule !== rule) throw new DomainError('VALIDATION_FAILED', { reason: 'COMPLETION_RULE' })
  const now = meta.clock.now()
  return db.transaction().execute(async (trx) => {
    const existing = await trx
      .selectFrom('activity_progress')
      .select(['id', 'status', 'completed_at'])
      .where('learner_id', '=', meta.actor.userId)
      .where('module_release_id', '=', release.id)
      .where('module_item_id', '=', item.id)
      .forUpdate()
      .executeTakeFirst()
    if (!existing) {
      const inserted = await trx
        .insertInto('activity_progress')
        .values({
          school_id: meta.actor.schoolId,
          learner_id: meta.actor.userId,
          module_release_id: release.id,
          module_item_id: item.id,
          status: 'completed',
          completion_rule: rule,
          source_event: source,
          completed_at: now,
          updated_at: now,
        })
        .onConflict((conflict) => conflict.columns(['learner_id', 'module_release_id', 'module_item_id']).doNothing())
        .returning(['completed_at'])
        .executeTakeFirst()
      if (inserted?.completed_at) return { status: 'completed', completedAt: inserted.completed_at.toISOString() }
      const raced = await trx
        .selectFrom('activity_progress')
        .select(['completed_at'])
        .where('learner_id', '=', meta.actor.userId)
        .where('module_release_id', '=', release.id)
        .where('module_item_id', '=', item.id)
        .executeTakeFirst()
      return { status: 'completed', completedAt: raced?.completed_at ? raced.completed_at.toISOString() : now.toISOString() }
    }
    if (existing.status === 'completed' && existing.completed_at) {
      return { status: 'completed', completedAt: existing.completed_at.toISOString() }
    }
    await trx
      .updateTable('activity_progress')
      .set({ status: 'completed', completed_at: now, updated_at: now, source_event: source })
      .where('id', '=', existing.id)
      .execute()
    return { status: 'completed', completedAt: now.toISOString() }
  })
}

export async function getSubmissionDraft(db: Db, meta: Meta, releaseId: string, itemId: string): Promise<Record<string, unknown>> {
  const release = await loadRelease(db, meta.actor.schoolId, releaseId)
  await requireStudentAction(db, meta, release, 'submission.draft')
  const item = await assignmentItem(db, release, itemId)
  if (item.item_type !== 'assignment') throw new DomainError('NOT_FOUND')
  const row = await db
    .selectFrom('submissions')
    .select(['id', 'draft_revision', 'draft_body', 'draft_updated_at', 'status'])
    .where('learner_id', '=', meta.actor.userId)
    .where('module_release_id', '=', release.id)
    .where('module_item_id', '=', item.id)
    .executeTakeFirst()
  if (!row) return { submissionId: null, draftRevision: 0, body: null, savedAt: null, status: 'draft' }
  return {
    submissionId: row.id,
    draftRevision: row.draft_revision,
    body: row.draft_body,
    savedAt: row.draft_updated_at ? row.draft_updated_at.toISOString() : null,
    status: row.status,
  }
}

export async function saveSubmissionDraft(
  db: Db,
  meta: Meta,
  releaseId: string,
  itemId: string,
  ifMatch: string | undefined,
  input: unknown,
): Promise<Record<string, unknown>> {
  const parsed = submissionBodyInput.safeParse(input)
  if (!parsed.success) throw new DomainError('VALIDATION_FAILED')
  const release = await loadRelease(db, meta.actor.schoolId, releaseId)
  await requireStudentAction(db, meta, release, 'submission.draft')
  const item = await assignmentItem(db, release, itemId)
  if (item.item_type !== 'assignment') throw new DomainError('NOT_FOUND')
  const expected = revisionFrom(ifMatch)
  assertDraftAllowed(item.submission_config, parsed.data)
  await assertOwnFiles(db, meta, parsed.data.fileIds ?? [], null)
  const now = meta.clock.now()
  return db.transaction().execute(async (trx) => {
    const current = await trx
      .selectFrom('submissions')
      .select(['id', 'draft_revision', 'status'])
      .where('learner_id', '=', meta.actor.userId)
      .where('module_release_id', '=', release.id)
      .where('module_item_id', '=', item.id)
      .forUpdate()
      .executeTakeFirst()
    if (!current) {
      if (expected !== 0) throw new DomainError('REVISION_CONFLICT', { currentRevision: 0 })
      const created = await trx
        .insertInto('submissions')
        .values({
          school_id: meta.actor.schoolId,
          learner_id: meta.actor.userId,
          module_release_id: release.id,
          module_item_id: item.id,
          status: 'draft',
          current_version_no: 0,
          draft_revision: 1,
          draft_body: asJson(parsed.data),
          draft_updated_at: now,
        })
        .returning(['id', 'draft_revision', 'status'])
        .executeTakeFirstOrThrow()
      return { submissionId: created.id, draftRevision: created.draft_revision, body: parsed.data, savedAt: now.toISOString(), status: created.status }
    }
    if (current.draft_revision !== expected) throw new DomainError('REVISION_CONFLICT', { currentRevision: current.draft_revision })
    const next = current.draft_revision + 1
    await trx
      .updateTable('submissions')
      .set({ draft_body: asJson(parsed.data), draft_revision: next, draft_updated_at: now })
      .where('id', '=', current.id)
      .execute()
    return { submissionId: current.id, draftRevision: next, body: parsed.data, savedAt: now.toISOString(), status: current.status }
  })
}

function assertDraftAllowed(config: unknown, input: SubmissionBodyInput): void {
  const rules = appliedSubmission(config)
  if (!rules.types.includes(input.body.type)) throw new DomainError('VALIDATION_FAILED', { reason: 'SUBMISSION_TYPE' })
  const count = input.fileIds?.length ?? 0
  if (!rules.allowFiles && count > 0) throw new DomainError('VALIDATION_FAILED', { reason: 'FILES_DISABLED' })
  if (count > rules.maxFiles) throw new DomainError('VALIDATION_FAILED', { reason: 'MAX_FILES' })
}

async function assertOwnFiles(db: Db | Trx, meta: Meta, fileIds: string[], submissionId: string | null): Promise<void> {
  if (fileIds.length === 0) return
  const rows = await db
    .selectFrom('files')
    .select(['id', 'owner_id', 'school_id'])
    .where('id', 'in', fileIds)
    .execute()
  if (rows.length !== fileIds.length) throw new DomainError('NOT_FOUND')
  if (rows.some((row) => row.owner_id !== meta.actor.userId || row.school_id !== meta.actor.schoolId)) throw new DomainError('NOT_FOUND')
  const attached = await db
    .selectFrom('submission_version_files')
    .innerJoin('submission_versions', 'submission_versions.id', 'submission_version_files.submission_version_id')
    .innerJoin('submissions', 'submissions.id', 'submission_versions.submission_id')
    .select(['submissions.id as submissionId'])
    .where('submission_version_files.file_id', 'in', fileIds)
    .execute()
  if (attached.some((row) => row.submissionId !== submissionId)) throw new DomainError('VALIDATION_FAILED', { reason: 'FILE_ATTACHED' })
}

export async function submitAssignment(
  db: Db,
  meta: Meta,
  releaseId: string,
  itemId: string,
  input: { draftRevision: number; idempotencyKey: string },
): Promise<Record<string, unknown>> {
  const release = await loadRelease(db, meta.actor.schoolId, releaseId)
  await requireStudentAction(db, meta, release, 'submission.create')
  assertSubmitOpen(release, meta.clock.now())
  const item = await assignmentItem(db, release, itemId)
  if (item.item_type !== 'assignment') throw new DomainError('NOT_FOUND')
  return withIdempotency(db, meta, {
    scope: `submit:${releaseId}:${itemId}`,
    key: input.idempotencyKey,
    requestHash: requestDigest({ draftRevision: input.draftRevision }),
    run: (trx) => writeSubmission(trx, meta, release, item, input.draftRevision),
  })
}

async function writeSubmission(
  trx: Trx,
  meta: Meta,
  release: ReleaseRow,
  item: ItemRow,
  draftRevision: number,
): Promise<Record<string, unknown>> {
  const current = await trx
    .selectFrom('submissions')
    .select(['id', 'draft_revision', 'draft_body', 'current_version_no'])
    .where('learner_id', '=', meta.actor.userId)
    .where('module_release_id', '=', release.id)
    .where('module_item_id', '=', item.id)
    .forUpdate()
    .executeTakeFirst()
  if (!current) throw new DomainError('REVISION_CONFLICT', { currentRevision: 0 })
  if (current.draft_revision !== draftRevision) throw new DomainError('REVISION_CONFLICT', { currentRevision: current.draft_revision })
  const parsed = submissionBodyInput.safeParse(current.draft_body)
  if (!parsed.success) throw new DomainError('VALIDATION_FAILED')
  assertDraftAllowed(item.submission_config, parsed.data)
  const fileIds = parsed.data.fileIds ?? []
  await assertOwnFiles(trx, meta, fileIds, current.id)
  if (fileIds.length > 0) {
    const files = await trx.selectFrom('files').select(['id', 'scan_status']).where('id', 'in', fileIds).execute()
    if (files.some((file) => file.scan_status === 'pending')) throw new DomainError('FILE_NOT_SCANNED')
    if (files.some((file) => file.scan_status === 'infected' || file.scan_status === 'error')) throw new DomainError('FILE_REJECTED')
  }
  const versionNo = current.current_version_no + 1
  const contentHash = requestDigest(parsed.data)
  const inserted = await sql<{
    id: string
    version_no: number
    submitted_at: Date
    is_late: boolean
  }>`
    INSERT INTO submission_versions (submission_id, version_no, body, reflection, content_hash, is_late)
    SELECT ${current.id}::uuid, ${versionNo}::int, ${JSON.stringify(parsed.data)}::jsonb, ${parsed.data.reflection ?? null},
           ${contentHash}, (module_releases.due_at IS NOT NULL AND now() > module_releases.due_at)
    FROM module_releases
    WHERE module_releases.id = ${release.id}::uuid
    RETURNING id, version_no, submitted_at, is_late
  `.execute(trx)
  const version = inserted.rows[0]
  if (!version) throw new DomainError('INTERNAL')
  for (const fileId of fileIds) {
    await trx.insertInto('submission_version_files').values({ submission_version_id: version.id, file_id: fileId }).execute()
  }
  await trx
    .updateTable('submissions')
    .set({ current_version_no: versionNo, status: 'submitted' })
    .where('id', '=', current.id)
    .execute()
  await upsertSubmitProgress(trx, meta, release.id, item.id, current.id)
  await audit(trx, meta, {
    action: 'submission.submit',
    objectType: 'submission',
    objectId: current.id,
    details: { versionNo: String(versionNo) },
  })
  await outbox(trx, {
    schoolId: meta.actor.schoolId,
    aggregateType: 'submission',
    aggregateId: current.id,
    eventType: 'SubmissionSubmitted',
    payload: { submissionId: current.id, versionNo: String(versionNo) },
  })
  return {
    submissionId: current.id,
    submissionVersionId: version.id,
    versionNo: version.version_no,
    submittedAt: version.submitted_at.toISOString(),
    isLate: version.is_late,
    contentHash,
  }
}

async function upsertSubmitProgress(trx: Trx, meta: Meta, releaseId: string, itemId: string, submissionId: string): Promise<void> {
  const now = meta.clock.now()
  const existing = await trx
    .selectFrom('activity_progress')
    .select(['id', 'status', 'completed_at'])
    .where('learner_id', '=', meta.actor.userId)
    .where('module_release_id', '=', releaseId)
    .where('module_item_id', '=', itemId)
    .forUpdate()
    .executeTakeFirst()
  const source = `submission:${submissionId}`
  if (!existing) {
    await trx
      .insertInto('activity_progress')
      .values({
        school_id: meta.actor.schoolId,
        learner_id: meta.actor.userId,
        module_release_id: releaseId,
        module_item_id: itemId,
        status: 'completed',
        completion_rule: 'submit',
        source_event: source,
        completed_at: now,
        updated_at: now,
      })
      .onConflict((conflict) =>
        conflict.columns(['learner_id', 'module_release_id', 'module_item_id']).doUpdateSet({
          status: 'completed',
          source_event: source,
          updated_at: now,
          completed_at: sql`coalesce(activity_progress.completed_at, ${now})`,
        }),
      )
      .execute()
    return
  }
  await trx
    .updateTable('activity_progress')
    .set({
      status: 'completed',
      source_event: source,
      updated_at: now,
      ...(existing.completed_at ? {} : { completed_at: now }),
    })
    .where('id', '=', existing.id)
    .execute()
}

export async function getSubmission(db: Db, meta: Meta, submissionId: string): Promise<Record<string, unknown>> {
  const row = await db
    .selectFrom('submissions')
    .innerJoin('module_releases', 'module_releases.id', 'submissions.module_release_id')
    .select([
      'submissions.id',
      'submissions.school_id',
      'submissions.learner_id',
      'submissions.status',
      'submissions.module_release_id',
      'module_releases.offering_id',
    ])
    .where('submissions.id', '=', submissionId)
    .executeTakeFirst()
  if (!row || row.school_id !== meta.actor.schoolId) throw new DomainError('NOT_FOUND')
  const role = meta.actor.roles[0]
  if (role === 'student') {
    if (row.learner_id !== meta.actor.userId) throw new DomainError('NOT_FOUND')
    const release = await loadRelease(db, meta.actor.schoolId, row.module_release_id)
    await learnerRelease(db, meta, release)
  } else if (role === 'teacher') {
    const caps = await capabilities(db, meta, row.offering_id)
    if (!caps.includes('review') && !caps.includes('view')) throw new DomainError('NOT_FOUND')
    authorize(meta.actor, 'submission.read', { reviewAssigned: caps.includes('review'), viewAssigned: caps.includes('view') })
  } else if (role === 'guardian') {
    const link = await db
      .selectFrom('guardian_links')
      .select('id')
      .where('guardian_id', '=', meta.actor.userId)
      .where('learner_id', '=', row.learner_id)
      .where('status', '=', 'verified')
      .where('school_id', '=', meta.actor.schoolId)
      .executeTakeFirst()
    if (!link) throw new DomainError('NOT_FOUND')
    authorize(meta.actor, 'submission.read', { guardianLinked: true })
  } else throw new DomainError('NOT_FOUND')
  const versions = await db
    .selectFrom('submission_versions')
    .select(['id', 'version_no', 'submitted_at', 'is_late', 'body'])
    .where('submission_id', '=', row.id)
    .orderBy('version_no')
    .execute()
  const fileRows = versions.length
    ? await db
        .selectFrom('submission_version_files')
        .select(['submission_version_id', 'file_id'])
        .where(
          'submission_version_id',
          'in',
          versions.map((version) => version.id),
        )
        .execute()
    : []
  return {
    id: row.id,
    status: row.status,
    versions: versions.map((version) => ({
      id: version.id,
      versionNo: version.version_no,
      submittedAt: version.submitted_at.toISOString(),
      isLate: version.is_late,
      body: role === 'guardian' ? null : version.body,
      fileIds: role === 'guardian' ? [] : fileRows.filter((file) => file.submission_version_id === version.id).map((file) => file.file_id),
    })),
    publishedReviews: [],
  }
}
