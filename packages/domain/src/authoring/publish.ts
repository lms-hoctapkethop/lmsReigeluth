import type { ModuleDraftStored } from '@hcn/contracts'
import { DomainError } from '../errors.ts'
import { audit, type Db, type Meta, type Trx } from '../org/support.ts'
import { authorizeModule } from './access.ts'
import { draftDigest, requestDigest } from './digest.ts'
import { asJson, asUuidArray } from './draft.ts'
import { quizQuestions } from './question.ts'
import { coverageOf, loadStoredDraft, type CoverageReportDto } from './validate.ts'

export type ModuleVersionSummary = {
  id: string
  moduleId: string
  versionNo: number
  digest: string
  publishedAt: string
}

const blockCodes = new Set(['V01', 'V05', 'V07'])

function acknowledgementHash(expectedRevision: number, acknowledgements: { code: string; target: string; reason: string }[]): string {
  const sorted = [...acknowledgements].sort((a, b) => `${a.code}:${a.target}`.localeCompare(`${b.code}:${b.target}`))
  return requestDigest({ expectedRevision, acknowledgements: sorted })
}

export async function publishModuleVersion(
  db: Db,
  meta: Meta,
  moduleId: string,
  input: { expectedRevision: number; acknowledgements: { code: string; target: string; reason: string }[]; idempotencyKey: string },
): Promise<ModuleVersionSummary> {
  if (input.idempotencyKey.length < 8 || input.idempotencyKey.length > 128) throw new DomainError('VALIDATION_FAILED')
  await authorizeModule(db, meta.actor, moduleId, 'module.publish')
  const scope = `publish:${moduleId}`
  const requestHash = acknowledgementHash(input.expectedRevision, input.acknowledgements)
  const existing = await db
    .selectFrom('idempotency_keys')
    .select(['status', 'request_hash', 'response_body'])
    .where('actor_id', '=', meta.actor.userId)
    .where('scope', '=', scope)
    .where('key', '=', input.idempotencyKey)
    .executeTakeFirst()
  if (existing?.status === 'completed') {
    if (existing.request_hash !== requestHash) throw new DomainError('IDEMPOTENCY_KEY_REUSED')
    return existing.response_body as ModuleVersionSummary
  }
  if (existing?.status === 'in_progress') throw new DomainError('REQUEST_IN_PROGRESS')

  try {
    await db
      .insertInto('idempotency_keys')
      .values({
        actor_id: meta.actor.userId,
        scope,
        key: input.idempotencyKey,
        request_hash: requestHash,
        status: 'in_progress',
        response_status: null,
        response_body: null,
        completed_at: null,
      })
      .execute()
  } catch {
    throw new DomainError('REQUEST_IN_PROGRESS')
  }

  try {
    const summary = await db.transaction().execute(async (trx) => {
      const locked = await trx.selectFrom('module_drafts').select(['revision']).where('module_id', '=', moduleId).forUpdate().executeTakeFirst()
      if (!locked) throw new DomainError('NOT_FOUND')
      if (locked.revision !== input.expectedRevision) throw new DomainError('REVISION_CONFLICT', { currentRevision: locked.revision })
      const { draft } = await loadStoredDraft(trx, moduleId)
      const report = await coverageOf(trx, draft)
      const blocks = report.warnings.filter((warning) => blockCodes.has(warning.code) || warning.level === 'block')
      if (blocks.length > 0) {
        throw new DomainError('COVERAGE_BLOCKED', { target: blocks[0]?.target ?? '', warnings: blocks })
      }
      const cautions = report.warnings.filter((warning) => warning.level === 'caution')
      const missing = cautions.filter(
        (warning) => !input.acknowledgements.some((ack) => ack.code === warning.code && ack.target === warning.target && ack.reason.trim().length >= 5),
      )
      if (missing.length > 0) {
        throw new DomainError('VALIDATION_FAILED', {
          missingAcknowledgements: missing.map((warning) => ({ code: warning.code, target: warning.target })),
        })
      }
      const digest = draftDigest(draft)
      const latest = await trx
        .selectFrom('module_versions')
        .select(['digest', 'version_no'])
        .where('module_id', '=', moduleId)
        .orderBy('version_no', 'desc')
        .executeTakeFirst()
      if (latest && latest.digest === digest) throw new DomainError('ALREADY_PUBLISHED')
      const versionNo = (latest?.version_no ?? 0) + 1
      const version = await trx
        .insertInto('module_versions')
        .values({
          school_id: meta.actor.schoolId,
          module_id: moduleId,
          version_no: versionNo,
          title: draft.title,
          description: draft.description ?? null,
          requirement_ids: asUuidArray(draft.requirementIds),
          coverage_report: asJson(report),
          coverage_ack: input.acknowledgements.length ? asJson(input.acknowledgements) : null,
          digest,
          published_by: meta.actor.userId,
        })
        .returning(['id', 'published_at'])
        .executeTakeFirstOrThrow()
      await insertItems(trx, version.id, draft)
      await audit(trx, meta, {
        action: 'module.publish',
        objectType: 'module_version',
        objectId: version.id,
        details: { moduleId, versionNo: String(versionNo), digest },
      })
      return {
        id: version.id,
        moduleId,
        versionNo,
        digest,
        publishedAt: version.published_at.toISOString(),
      }
    })
    await db
      .updateTable('idempotency_keys')
      .set({
        status: 'completed',
        response_status: 201,
        response_body: summary as unknown as Record<string, unknown>,
        completed_at: meta.clock.now(),
      })
      .where('actor_id', '=', meta.actor.userId)
      .where('scope', '=', scope)
      .where('key', '=', input.idempotencyKey)
      .execute()
    return summary
  } catch (error) {
    await db
      .deleteFrom('idempotency_keys')
      .where('actor_id', '=', meta.actor.userId)
      .where('scope', '=', scope)
      .where('key', '=', input.idempotencyKey)
      .where('status', '=', 'in_progress')
      .execute()
    throw error
  }
}

async function insertItems(db: Db | Trx, moduleVersionId: string, draft: ModuleDraftStored): Promise<void> {
  for (let position = 0; position < draft.items.length; position += 1) {
    const item = draft.items[position]
    if (!item) continue
    let rubricVersionId: string | null = null
    if (item.type === 'assignment' && item.rubric) {
      const rubric = await db
        .insertInto('rubric_versions')
        .values({ module_version_id: moduleVersionId, title: item.rubric.title })
        .returning('id')
        .executeTakeFirstOrThrow()
      rubricVersionId = rubric.id
      for (let index = 0; index < item.rubric.criteria.length; index += 1) {
        const criterion = item.rubric.criteria[index]
        if (!criterion) continue
        await db
          .insertInto('rubric_criteria')
          .values({
            rubric_version_id: rubric.id,
            position: index,
            title: criterion.title,
            kc_version_id: criterion.kcVersionId,
            level_meets: criterion.levels.meets,
            level_developing: criterion.levels.developing,
            level_not_yet: criterion.levels.notYet,
          })
          .execute()
      }
    }
    if (item.type === 'quiz' && item.assessment.purpose !== 'practice' && item.assessment.hintsEnabled) {
      throw new DomainError('VALIDATION_FAILED', { reason: 'HINTS_PURPOSE' })
    }
    const inserted = await db
      .insertInto('module_items')
      .values({
        module_version_id: moduleVersionId,
        position,
        item_type: item.type,
        indent: item.indent,
        title: item.title,
        body: item.type === 'page' || item.type === 'assignment' ? asJson(item.body) : null,
        url: item.type === 'link' ? item.url : null,
        completion_rule: item.completion,
        rubric_version_id: item.type === 'assignment' ? rubricVersionId : null,
        requirement_ids: asUuidArray(item.type === 'assignment' ? item.requirementIds : []),
      })
      .returning('id')
      .executeTakeFirstOrThrow()
    if (item.type !== 'quiz') continue
    const assessment = await db
      .insertInto('assessment_versions')
      .values({
        module_version_id: moduleVersionId,
        module_item_id: inserted.id,
        purpose: item.assessment.purpose,
        max_attempts: item.assessment.maxAttempts,
        show_feedback: item.assessment.showFeedback,
        hints_enabled: item.assessment.purpose === 'practice' && item.assessment.hintsEnabled,
        shuffle_options: item.assessment.shuffleOptions,
      })
      .returning('id')
      .executeTakeFirstOrThrow()
    const questions = quizQuestions(item)
    for (let index = 0; index < questions.length; index += 1) {
      const question = questions[index]
      if (!question) continue
      const choice = question.qtype === 'single_choice' || question.qtype === 'multi_choice'
      const created = await db
        .insertInto('question_items')
        .values({
          assessment_version_id: assessment.id,
          position: index,
          qtype: question.qtype,
          stem: asJson(question.stem),
          options: choice ? asJson(question.options ?? []) : null,
          bloom_target: question.bloomTarget,
          variant_group: question.variantGroup ?? null,
          difficulty_prior: question.difficultyPrior ?? null,
          difficulty_calibrated: null,
          provisional: question.provisional ?? false,
          hints: asJson(question.hints ?? []),
          source: question.source ?? 'teacher',
          ai_proposal_id: null,
          approved_by: question.approvedBy ?? null,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
      await db
        .insertInto('question_keys')
        .values({
          question_item_id: created.id,
          key: asJson(question.answerKey),
          rationale: question.rationale ? asJson(question.rationale) : null,
        })
        .execute()
      for (const kc of new Set(question.kcRequired)) {
        await db.insertInto('question_kc_links').values({ question_item_id: created.id, kc_version_id: kc, role: 'required' }).execute()
      }
      for (const kc of new Set(question.kcObservable)) {
        await db.insertInto('question_kc_links').values({ question_item_id: created.id, kc_version_id: kc, role: 'observable' }).execute()
      }
      for (const [optionId, misconceptionId] of Object.entries(question.optionMisconceptions ?? {})) {
        await db
          .insertInto('option_misconceptions')
          .values({ question_item_id: created.id, option_id: optionId, misconception_id: misconceptionId })
          .execute()
      }
    }
  }
}

export type { CoverageReportDto }
