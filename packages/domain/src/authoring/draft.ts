import { sql, type RawBuilder } from 'kysely'
import { parseModuleDraft, type ModuleDraftStored } from '@hcn/contracts'
import { DomainError } from '../errors.ts'
import { authorize } from '../identity/policies.ts'
import type { Db, Meta, Trx } from '../org/support.ts'
import { toLearnerRelease } from '../learning/projection.ts'
import { authorAssigned, authorizeModule } from './access.ts'
import { quizQuestions, type StoredQuestion } from './question.ts'

export type ModuleEnvelope = {
  moduleId: string
  courseId: string
  revision: number
  payload: unknown
  updatedAt: string
  latestVersionNo: number | null
}

function asJson(value: unknown): RawBuilder<unknown> {
  return sql`${JSON.stringify(value)}::jsonb`
}

function asUuidArray(ids: readonly string[]): RawBuilder<string[]> {
  if (ids.length === 0) return sql`'{}'::uuid[]`
  return sql`ARRAY[${sql.join(ids.map((id) => sql`${id}::uuid`))}]::uuid[]`
}

export function revisionFrom(header: string | undefined): number {
  if (!header) throw new DomainError('VALIDATION_FAILED', { reason: 'IF_MATCH' })
  const match = /^(?:W\/)?"?(\d+)"?$/.exec(header.trim())
  const digits = match?.[1]
  if (!digits) throw new DomainError('VALIDATION_FAILED', { reason: 'IF_MATCH' })
  return Number(digits)
}

type ServerFields = { source?: 'teacher' | 'library' | 'ai_proposal' | 'import'; approvedBy?: string | null; provisional?: boolean }

function serverFieldsOf(payload: unknown): Map<string, ServerFields> {
  const map = new Map<string, ServerFields>()
  const draft = payload as { items?: { assessment?: { questions?: Record<string, unknown>[] } }[] }
  for (const item of draft.items ?? []) {
    for (const question of (item.assessment?.questions ?? []) as StoredQuestion[]) {
      if (typeof question.clientKey !== 'string') continue
      const fields: ServerFields = {}
      if (question.source === 'teacher' || question.source === 'library' || question.source === 'ai_proposal' || question.source === 'import') {
        fields.source = question.source
      }
      if (question.approvedBy === null || typeof question.approvedBy === 'string') fields.approvedBy = question.approvedBy
      if (typeof question.provisional === 'boolean') fields.provisional = question.provisional
      map.set(question.clientKey, fields)
    }
  }
  return map
}

function withServerFields(draft: ModuleDraftStored, previous: Map<string, ServerFields>): ModuleDraftStored {
  return {
    ...draft,
    items: draft.items.map((item) => {
      if (item.type !== 'quiz') return item
      return {
        ...item,
        assessment: {
          ...item.assessment,
          questions: quizQuestions(item).map((question) => {
            const kept = previous.get(question.clientKey)
            if (!kept) return { ...question, source: 'teacher' as const, provisional: false }
            return { ...question, ...kept, source: kept.source ?? 'teacher', provisional: kept.provisional ?? false }
          }),
        },
      }
    }),
  }
}

export function stripServerFields(draft: ModuleDraftStored): unknown {
  return {
    ...draft,
    items: draft.items.map((item) => {
      if (item.type !== 'quiz') return item
      return {
        ...item,
        assessment: {
          ...item.assessment,
          questions: quizQuestions(item).map((question) => {
            const copy: StoredQuestion = { ...question }
            delete copy.source
            delete copy.approvedBy
            delete copy.provisional
            return copy
          }),
        },
      }
    }),
  }
}

function parseInput(payload: unknown): ModuleDraftStored {
  const parsed = parseModuleDraft(payload, 'input')
  if (!parsed.ok) throw new DomainError(parsed.code)
  return parsed.draft
}

async function assertReferences(db: Db | Trx, draft: ModuleDraftStored, course: { subject_code: string; grade: number }): Promise<void> {
  if (draft.requirementIds.length > 0) {
    const requirements = await db
      .selectFrom('curriculum_requirements')
      .select(['id', 'review_status', 'subject_code', 'grade'])
      .where('id', 'in', draft.requirementIds)
      .execute()
    if (requirements.length !== new Set(draft.requirementIds).size) throw new DomainError('VALIDATION_FAILED', { reason: 'REQUIREMENT' })
    if (requirements.some((row) => row.review_status !== 'approved' || row.subject_code !== course.subject_code || row.grade !== course.grade)) {
      throw new DomainError('VALIDATION_FAILED', { reason: 'REQUIREMENT' })
    }
  }
  const kcIds = new Set<string>()
  const misconceptionIds = new Set<string>()
  for (const item of draft.items) {
    if (item.type === 'assignment' && item.rubric) {
      for (const criterion of item.rubric.criteria) if (criterion.kcVersionId) kcIds.add(criterion.kcVersionId)
    }
    if (item.type !== 'quiz') continue
    for (const question of quizQuestions(item)) {
      for (const id of question.kcObservable) kcIds.add(id)
      for (const id of question.kcRequired) kcIds.add(id)
      for (const id of Object.values(question.optionMisconceptions ?? {})) misconceptionIds.add(id)
    }
  }
  const versions = kcIds.size
    ? await db.selectFrom('kc_versions').select(['id', 'kc_id', 'status']).where('id', 'in', [...kcIds]).execute()
    : []
  if (versions.length !== kcIds.size || versions.some((row) => row.status !== 'approved')) {
    throw new DomainError('VALIDATION_FAILED', { reason: 'KC' })
  }
  const kcOfVersion = new Map(versions.map((row) => [row.id, row.kc_id]))
  if (misconceptionIds.size === 0) return
  const misconceptions = await db
    .selectFrom('misconceptions')
    .select(['id', 'kc_id', 'status'])
    .where('id', 'in', [...misconceptionIds])
    .execute()
  const byId = new Map(misconceptions.map((row) => [row.id, row]))
  for (const item of draft.items) {
    if (item.type !== 'quiz') continue
    for (const question of quizQuestions(item)) {
      const owners = new Set(question.kcObservable.map((id) => kcOfVersion.get(id)).filter((id): id is string => Boolean(id)))
      for (const id of Object.values(question.optionMisconceptions ?? {})) {
        const row = byId.get(id)
        if (!row || row.status !== 'approved' || !owners.has(row.kc_id)) throw new DomainError('VALIDATION_FAILED', { reason: 'MISCONCEPTION' })
      }
    }
  }
}

async function latestVersionNo(db: Db | Trx, moduleId: string): Promise<number | null> {
  const row = await db
    .selectFrom('module_versions')
    .select('version_no')
    .where('module_id', '=', moduleId)
    .orderBy('version_no', 'desc')
    .executeTakeFirst()
  return row?.version_no ?? null
}

function envelope(moduleId: string, courseId: string, revision: number, payload: unknown, updatedAt: Date, latest: number | null): ModuleEnvelope {
  return { moduleId, courseId, revision, payload, updatedAt: updatedAt.toISOString(), latestVersionNo: latest }
}

export async function createModule(
  db: Db,
  meta: Meta,
  input: { courseId: string; title: string; requirementIds: string[] },
): Promise<ModuleEnvelope> {
  const course = await db
    .selectFrom('courses')
    .select(['id', 'school_id', 'subject_code', 'grade'])
    .where('id', '=', input.courseId)
    .executeTakeFirst()
  if (!course || course.school_id !== meta.actor.schoolId) throw new DomainError('NOT_FOUND')
  const assigned = await authorAssigned(db, meta.actor, course.id)
  authorize(meta.actor, 'module.create', { authorAssigned: assigned })
  const payload: ModuleDraftStored = {
    schema: 'module-draft/1',
    title: input.title,
    requirementIds: input.requirementIds,
    items: [],
  }
  await assertReferences(db, payload, course)
  const now = meta.clock.now()
  return db.transaction().execute(async (trx) => {
    const created = await trx
      .insertInto('modules')
      .values({ school_id: meta.actor.schoolId, course_id: course.id, owner_id: meta.actor.userId })
      .returning('id')
      .executeTakeFirstOrThrow()
    await trx
      .insertInto('module_drafts')
      .values({
        module_id: created.id,
        school_id: meta.actor.schoolId,
        revision: 1,
        payload: asJson(payload),
        updated_by: meta.actor.userId,
        updated_at: now,
      })
      .execute()
    return envelope(created.id, course.id, 1, stripServerFields(payload), now, null)
  })
}

export async function getModuleDraft(db: Db, meta: Meta, moduleId: string): Promise<ModuleEnvelope> {
  const { courseId } = await authorizeModule(db, meta.actor, moduleId, 'module.edit')
  const row = await db
    .selectFrom('module_drafts')
    .select(['revision', 'payload', 'updated_at'])
    .where('module_id', '=', moduleId)
    .where('school_id', '=', meta.actor.schoolId)
    .executeTakeFirst()
  if (!row) throw new DomainError('NOT_FOUND')
  const parsed = parseModuleDraft(row.payload, 'stored')
  if (!parsed.ok) throw new DomainError(parsed.code)
  return envelope(moduleId, courseId, row.revision, stripServerFields(parsed.draft), row.updated_at, await latestVersionNo(db, moduleId))
}

export async function saveModuleDraft(db: Db, meta: Meta, moduleId: string, ifMatch: string | undefined, payload: unknown): Promise<ModuleEnvelope> {
  const expected = revisionFrom(ifMatch)
  const { courseId } = await authorizeModule(db, meta.actor, moduleId, 'module.edit')
  const course = await db.selectFrom('courses').select(['subject_code', 'grade']).where('id', '=', courseId).executeTakeFirstOrThrow()
  const incoming = parseInput(payload)
  await assertReferences(db, incoming, course)
  const now = meta.clock.now()
  return db.transaction().execute(async (trx) => {
    const current = await trx
      .selectFrom('module_drafts')
      .select(['revision', 'payload'])
      .where('module_id', '=', moduleId)
      .forUpdate()
      .executeTakeFirst()
    if (!current) throw new DomainError('NOT_FOUND')
    if (current.revision !== expected) throw new DomainError('REVISION_CONFLICT', { currentRevision: current.revision })
    const stored = withServerFields(incoming, serverFieldsOf(current.payload))
    await trx
      .updateTable('module_drafts')
      .set({ payload: asJson(stored), revision: current.revision + 1, updated_by: meta.actor.userId, updated_at: now })
      .where('module_id', '=', moduleId)
      .execute()
    return envelope(moduleId, courseId, current.revision + 1, stripServerFields(stored), now, await latestVersionNo(trx, moduleId))
  })
}

export async function listMyModules(db: Db, meta: Meta, courseId: string): Promise<{ id: string; title: string; revision: number; latestVersionNo: number | null; updatedAt: string }[]> {
  const course = await db.selectFrom('courses').select(['id', 'school_id']).where('id', '=', courseId).executeTakeFirst()
  if (!course || course.school_id !== meta.actor.schoolId) throw new DomainError('NOT_FOUND')
  const assigned = await authorAssigned(db, meta.actor, courseId)
  authorize(meta.actor, 'module.create', { authorAssigned: assigned })
  const rows = await db
    .selectFrom('modules')
    .innerJoin('module_drafts', 'module_drafts.module_id', 'modules.id')
    .select(['modules.id', 'modules.owner_id', 'module_drafts.revision', 'module_drafts.payload', 'module_drafts.updated_at'])
    .where('modules.course_id', '=', courseId)
    .where('modules.school_id', '=', meta.actor.schoolId)
    .orderBy('module_drafts.updated_at', 'desc')
    .execute()
  const visible = []
  for (const row of rows) {
    const editor = row.owner_id === meta.actor.userId
      ? true
      : Boolean(
          await db
            .selectFrom('module_collaborators')
            .select('role')
            .where('module_id', '=', row.id)
            .where('user_id', '=', meta.actor.userId)
            .where('role', '=', 'editor')
            .executeTakeFirst(),
        )
    if (!editor) continue
    const title = typeof (row.payload as { title?: unknown }).title === 'string' ? (row.payload as { title: string }).title : 'Module'
    const latest = await latestVersionNo(db, row.id)
    visible.push({ id: row.id, title, revision: row.revision, latestVersionNo: latest, updatedAt: row.updated_at.toISOString() })
  }
  return visible
}

export async function listAuthorCourses(db: Db, meta: Meta): Promise<{ id: string; title: string; subjectCode: string; grade: number }[]> {
  if (!meta.actor.roles.includes('teacher')) throw new DomainError('FORBIDDEN')
  const rows = await db
    .selectFrom('courses')
    .innerJoin('offerings', 'offerings.course_id', 'courses.id')
    .innerJoin('teacher_assignments', 'teacher_assignments.offering_id', 'offerings.id')
    .select(['courses.id', 'courses.title', 'courses.subject_code', 'courses.grade'])
    .where('courses.school_id', '=', meta.actor.schoolId)
    .where('teacher_assignments.teacher_id', '=', meta.actor.userId)
    .where('teacher_assignments.school_id', '=', meta.actor.schoolId)
    .where(sql<boolean>`teacher_assignments.capabilities @> ARRAY['author']::text[]`)
    .where(sql<boolean>`teacher_assignments.valid @> now()`)
    .orderBy('courses.title')
    .execute()
  const seen = new Set<string>()
  return rows.flatMap((row) => {
    if (seen.has(row.id)) return []
    seen.add(row.id)
    return [{ id: row.id, title: row.title, subjectCode: row.subject_code, grade: row.grade }]
  })
}

export type AuthoringCatalog = {
  course: { id: string; title: string; subjectCode: string; grade: number }
  requirements: { id: string; code791Stem: string; text: string; reviewStatus: string; bloomLevel: number | null }[]
  kcs: { id: string; kcId: string; code: string; name: string }[]
  misconceptions: { id: string; code: string; kcId: string; description: string }[]
  links: { requirementId: string; kcVersionId: string }[]
}

export async function authoringCatalog(db: Db, meta: Meta, courseId: string): Promise<AuthoringCatalog> {
  const course = await db
    .selectFrom('courses')
    .select(['id', 'school_id', 'title', 'subject_code', 'grade'])
    .where('id', '=', courseId)
    .executeTakeFirst()
  if (!course || course.school_id !== meta.actor.schoolId) throw new DomainError('NOT_FOUND')
  const assigned = await authorAssigned(db, meta.actor, courseId)
  authorize(meta.actor, 'module.create', { authorAssigned: assigned })
  const requirements = await db
    .selectFrom('curriculum_requirements')
    .select(['id', 'code791_stem', 'text', 'review_status', 'bloom_level'])
    .where('subject_code', '=', course.subject_code)
    .where('grade', '=', course.grade)
    .orderBy('code791_stem')
    .execute()
  const kcs = await db
    .selectFrom('kc_versions')
    .innerJoin('knowledge_components', 'knowledge_components.id', 'kc_versions.kc_id')
    .select(['kc_versions.id', 'kc_versions.kc_id', 'knowledge_components.code', 'kc_versions.name'])
    .where('kc_versions.status', '=', 'approved')
    .where('knowledge_components.subject_code', '=', course.subject_code)
    .orderBy('knowledge_components.code')
    .execute()
  const kcIds = kcs.map((row) => row.kc_id)
  const misconceptions = kcIds.length
    ? await db
        .selectFrom('misconceptions')
        .select(['id', 'code', 'kc_id', 'description'])
        .where('status', '=', 'approved')
        .where('kc_id', 'in', kcIds)
        .orderBy('code')
        .execute()
    : []
  const requirementIds = requirements.map((row) => row.id)
  const links = requirementIds.length
    ? await db
        .selectFrom('requirement_kc_links')
        .select(['requirement_id', 'kc_version_id'])
        .where('status', '=', 'approved')
        .where('requirement_id', 'in', requirementIds)
        .execute()
    : []
  return {
    course: { id: course.id, title: course.title, subjectCode: course.subject_code, grade: course.grade },
    requirements: requirements.map((row) => ({
      id: row.id,
      code791Stem: row.code791_stem,
      text: row.text,
      reviewStatus: row.review_status,
      bloomLevel: row.bloom_level,
    })),
    kcs: kcs.map((row) => ({ id: row.id, kcId: row.kc_id, code: row.code, name: row.name })),
    misconceptions: misconceptions.map((row) => ({ id: row.id, code: row.code, kcId: row.kc_id, description: row.description })),
    links: links.map((row) => ({ requirementId: row.requirement_id, kcVersionId: row.kc_version_id })),
  }
}

export async function previewModuleDraftAsLearner(db: Db, meta: Meta, moduleId: string): Promise<Record<string, unknown>> {
  await authorizeModule(db, meta.actor, moduleId, 'module.edit')
  const row = await db.selectFrom('module_drafts').select('payload').where('module_id', '=', moduleId).executeTakeFirst()
  if (!row) throw new DomainError('NOT_FOUND')
  return { ...toLearnerRelease(row.payload), preview: true }
}

export { asJson, asUuidArray }
