import { sql } from 'kysely'
import { DomainError } from '../errors.ts'
import { requestDigest } from '../authoring/digest.ts'
import { withIdempotency } from '../idempotency.ts'
import { authorize } from '../identity/policies.ts'
import { asJson } from '../json.ts'
import { audit, outbox, type Db, type Meta } from '../org/support.ts'
import { capabilities } from '../learning/gate.ts'

export type ReleaseReceipt = {
  pathReleaseId: string
  moduleReleaseIds: string[]
  createdAt: string
}

export type ModuleReleaseSummary = {
  id: string
  moduleVersionId: string
  moduleId: string
  title: string
  availableFrom: string
  dueAt: string | null
  acceptUntil: string | null
  latePolicy: 'reject' | 'accept_marked'
  scheduleRevision: number
}

type ReleaseModule = {
  moduleVersionId: string
  availableFrom: string
  dueAt?: string | null
  acceptUntil?: string | null
  latePolicy?: 'reject' | 'accept_marked'
}

function instant(value: string): Date {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new DomainError('VALIDATION_FAILED')
  return date
}

function summary(row: {
  id: string
  module_version_id: string
  module_id: string
  title: string
  available_from: Date
  due_at: Date | null
  accept_until: Date | null
  late_policy: 'reject' | 'accept_marked'
  schedule_revision: number
}): ModuleReleaseSummary {
  return {
    id: row.id,
    moduleVersionId: row.module_version_id,
    moduleId: row.module_id,
    title: row.title,
    availableFrom: row.available_from.toISOString(),
    dueAt: row.due_at ? row.due_at.toISOString() : null,
    acceptUntil: row.accept_until ? row.accept_until.toISOString() : null,
    latePolicy: row.late_policy,
    scheduleRevision: row.schedule_revision,
  }
}

async function offeringCourse(db: Db, meta: Meta, offeringId: string): Promise<string> {
  const offering = await db.selectFrom('offerings').select(['id', 'school_id', 'course_id']).where('id', '=', offeringId).executeTakeFirst()
  if (!offering || offering.school_id !== meta.actor.schoolId) throw new DomainError('NOT_FOUND')
  return offering.course_id
}

export async function releaseModules(
  db: Db,
  meta: Meta,
  offeringId: string,
  input: { title: string; modules: ReleaseModule[]; idempotencyKey: string },
): Promise<ReleaseReceipt> {
  if (input.title.trim().length === 0 || input.modules.length < 1 || input.modules.length > 20) {
    throw new DomainError('VALIDATION_FAILED')
  }
  const courseId = await offeringCourse(db, meta, offeringId)
  const caps = await capabilities(db, meta, offeringId)
  authorize(meta.actor, 'release.create', { releaseAssigned: caps.includes('release') })
  const normalized = input.modules.map((item) => ({
    moduleVersionId: item.moduleVersionId,
    availableFrom: item.availableFrom,
    dueAt: item.dueAt ?? null,
    acceptUntil: item.acceptUntil ?? null,
    latePolicy: item.latePolicy ?? 'accept_marked',
  }))
  return withIdempotency(db, meta, {
    scope: `release:${offeringId}`,
    key: input.idempotencyKey,
    requestHash: requestDigest({ title: input.title, modules: normalized }),
    run: async (trx) => {
      const ids: string[] = []
      const path = await trx
        .insertInto('path_releases')
        .values({
          school_id: meta.actor.schoolId,
          offering_id: offeringId,
          title: input.title.trim(),
          created_by: meta.actor.userId,
        })
        .returning(['id', 'created_at'])
        .executeTakeFirstOrThrow()
      for (let position = 0; position < normalized.length; position += 1) {
        const item = normalized[position]
        if (!item) continue
        const version = await trx
          .selectFrom('module_versions')
          .innerJoin('modules', 'modules.id', 'module_versions.module_id')
          .select(['module_versions.id', 'modules.course_id', 'modules.school_id'])
          .where('module_versions.id', '=', item.moduleVersionId)
          .executeTakeFirst()
        if (!version || version.school_id !== meta.actor.schoolId) throw new DomainError('NOT_FOUND')
        if (version.course_id !== courseId) {
          throw new DomainError('VALIDATION_FAILED', { reason: 'MODULE_COURSE', moduleVersionId: item.moduleVersionId })
        }
        const availableFrom = instant(item.availableFrom)
        const dueAt = item.dueAt ? instant(item.dueAt) : null
        const acceptUntil = item.acceptUntil ? instant(item.acceptUntil) : null
        if (dueAt && dueAt.getTime() <= availableFrom.getTime()) throw new DomainError('VALIDATION_FAILED', { reason: 'SCHEDULE' })
        if (acceptUntil && (!dueAt || acceptUntil.getTime() < dueAt.getTime())) throw new DomainError('VALIDATION_FAILED', { reason: 'SCHEDULE' })
        const created = await trx
          .insertInto('module_releases')
          .values({
            school_id: meta.actor.schoolId,
            offering_id: offeringId,
            path_release_id: path.id,
            module_version_id: item.moduleVersionId,
            position,
            available_from: availableFrom,
            due_at: dueAt,
            accept_until: acceptUntil,
            late_policy: item.latePolicy,
          })
          .returning('id')
          .executeTakeFirstOrThrow()
        ids.push(created.id)
      }
      await audit(trx, meta, {
        action: 'release.create',
        objectType: 'path_release',
        objectId: path.id,
        details: { offeringId, count: String(ids.length) },
      })
      await outbox(trx, {
        schoolId: meta.actor.schoolId,
        aggregateType: 'path_release',
        aggregateId: path.id,
        eventType: 'ReleaseCreated',
        payload: { pathReleaseId: path.id, offeringId },
      })
      return { pathReleaseId: path.id, moduleReleaseIds: ids, createdAt: path.created_at.toISOString() }
    },
  })
}

export async function listReleases(db: Db, meta: Meta, offeringId: string): Promise<ModuleReleaseSummary[]> {
  const courseId = await offeringCourse(db, meta, offeringId)
  void courseId
  const role = meta.actor.roles[0]
  if (role === 'teacher') {
    const caps = await capabilities(db, meta, offeringId)
    if (caps.length === 0) throw new DomainError('NOT_FOUND')
  } else if (role === 'student') {
    const enrolled = await db
      .selectFrom('offering_enrollments')
      .select('id')
      .where('offering_id', '=', offeringId)
      .where('learner_id', '=', meta.actor.userId)
      .where('status', '=', 'active')
      .executeTakeFirst()
    if (!enrolled) throw new DomainError('NOT_FOUND')
  } else throw new DomainError('NOT_FOUND')
  let query = db
    .selectFrom('module_releases')
    .innerJoin('module_versions', 'module_versions.id', 'module_releases.module_version_id')
    .select([
      'module_releases.id',
      'module_releases.module_version_id',
      'module_versions.module_id',
      'module_versions.title',
      'module_releases.available_from',
      'module_releases.due_at',
      'module_releases.accept_until',
      'module_releases.late_policy',
      'module_releases.schedule_revision',
    ])
    .where('module_releases.offering_id', '=', offeringId)
    .where('module_releases.school_id', '=', meta.actor.schoolId)
    .orderBy('module_releases.available_from')
  if (role === 'student') query = query.where('module_releases.available_from', '<=', meta.clock.now())
  const rows = await query.execute()
  return rows.map(summary)
}

export async function changeSchedule(
  db: Db,
  meta: Meta,
  releaseId: string,
  input: { dueAt?: string | null; acceptUntil?: string | null; reason: string; ifMatch: string | undefined },
): Promise<ModuleReleaseSummary> {
  if (input.reason.trim().length < 3) throw new DomainError('VALIDATION_FAILED', { reason: 'REASON' })
  const match = /^(?:W\/)?"?(\d+)"?$/.exec(input.ifMatch?.trim() ?? '')
  if (!match?.[1]) throw new DomainError('VALIDATION_FAILED', { reason: 'IF_MATCH' })
  const expected = Number(match[1])
  return db.transaction().execute(async (trx) => {
    const current = await trx
      .selectFrom('module_releases')
      .innerJoin('module_versions', 'module_versions.id', 'module_releases.module_version_id')
      .select([
        'module_releases.id',
        'module_releases.school_id',
        'module_releases.offering_id',
        'module_releases.available_from',
        'module_releases.due_at',
        'module_releases.accept_until',
        'module_releases.late_policy',
        'module_releases.schedule_revision',
        'module_releases.module_version_id',
        'module_versions.module_id',
        'module_versions.title',
      ])
      .where('module_releases.id', '=', releaseId)
      .forUpdate()
      .executeTakeFirst()
    if (!current || current.school_id !== meta.actor.schoolId) throw new DomainError('NOT_FOUND')
    const caps = await capabilities(trx, meta, current.offering_id)
    authorize(meta.actor, 'release.change', { releaseAssigned: caps.includes('release') })
    if (current.schedule_revision !== expected) throw new DomainError('REVISION_CONFLICT', { currentRevision: current.schedule_revision })
    const dueAt = input.dueAt === undefined ? current.due_at : input.dueAt ? instant(input.dueAt) : null
    const acceptUntil = input.acceptUntil === undefined ? current.accept_until : input.acceptUntil ? instant(input.acceptUntil) : null
    if (dueAt && dueAt.getTime() <= current.available_from.getTime()) throw new DomainError('VALIDATION_FAILED', { reason: 'SCHEDULE' })
    if (acceptUntil && (!dueAt || acceptUntil.getTime() < dueAt.getTime())) throw new DomainError('VALIDATION_FAILED', { reason: 'SCHEDULE' })
    const oldValues = { dueAt: current.due_at?.toISOString() ?? null, acceptUntil: current.accept_until?.toISOString() ?? null }
    const newValues = { dueAt: dueAt?.toISOString() ?? null, acceptUntil: acceptUntil?.toISOString() ?? null }
    await trx
      .insertInto('release_schedule_changes')
      .values({
        module_release_id: current.id,
        from_revision: current.schedule_revision,
        old_values: asJson(oldValues),
        new_values: asJson(newValues),
        reason: input.reason.trim(),
        changed_by: meta.actor.userId,
      })
      .execute()
    await trx
      .updateTable('module_releases')
      .set({
        due_at: dueAt,
        accept_until: acceptUntil,
        schedule_revision: current.schedule_revision + 1,
      })
      .where('id', '=', current.id)
      .execute()
    await audit(trx, meta, {
      action: 'release.change',
      objectType: 'module_release',
      objectId: current.id,
      details: { fromRevision: String(current.schedule_revision) },
    })
    return summary({ ...current, due_at: dueAt, accept_until: acceptUntil, schedule_revision: current.schedule_revision + 1 })
  })
}

export async function listModuleVersions(
  db: Db,
  meta: Meta,
  moduleId: string,
): Promise<{ id: string; versionNo: number; title: string; publishedAt: string; digest: string }[]> {
  const moduleRow = await db.selectFrom('modules').select(['id', 'school_id', 'course_id']).where('id', '=', moduleId).executeTakeFirst()
  if (!moduleRow || moduleRow.school_id !== meta.actor.schoolId) throw new DomainError('NOT_FOUND')
  const rows = await db
    .selectFrom('teacher_assignments')
    .innerJoin('offerings', 'offerings.id', 'teacher_assignments.offering_id')
    .select('teacher_assignments.capabilities')
    .where('teacher_assignments.teacher_id', '=', meta.actor.userId)
    .where('teacher_assignments.school_id', '=', meta.actor.schoolId)
    .where('offerings.course_id', '=', moduleRow.course_id)
    .where(sql<boolean>`teacher_assignments.valid @> now()`)
    .execute()
  const allowed = rows.some((row) => row.capabilities.includes('author') || row.capabilities.includes('release'))
  authorize(meta.actor, 'release.create', { releaseAssigned: allowed && meta.actor.roles.includes('teacher') })
  const versions = await db
    .selectFrom('module_versions')
    .select(['id', 'version_no', 'title', 'published_at', 'digest'])
    .where('module_id', '=', moduleId)
    .orderBy('version_no', 'desc')
    .execute()
  return versions.map((row) => ({
    id: row.id,
    versionNo: row.version_no,
    title: row.title,
    publishedAt: row.published_at.toISOString(),
    digest: row.digest,
  }))
}
