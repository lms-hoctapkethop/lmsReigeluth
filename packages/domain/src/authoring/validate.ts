import { parseModuleDraft, type ModuleDraftStored } from '@hcn/contracts'
import { effectivePrerequisites } from '@hcn/db'
import { DomainError } from '../errors.ts'
import type { Db, Meta, Trx } from '../org/support.ts'
import { computeCoverage, type CoverageDraft, type CoverageWarning } from './coverage.ts'
import { authorizeModule } from './access.ts'
import { quizQuestions } from './question.ts'

const messages: Record<string, string> = {
  V01: 'Yêu cầu chưa có quan sát.',
  V02: 'Bloom cao nhưng chỉ có câu trắc nghiệm.',
  V03: 'Luyện tập chưa có gợi ý.',
  V04: 'Phương án sai chưa gắn lỗi hiểu sai.',
  V05: 'KC chưa duyệt hoặc ngoài phạm vi yêu cầu.',
  V06: 'Tiên quyết ngoài khối chưa có tài liệu ôn.',
  V07: 'Câu từ AI chưa có người duyệt.',
  V08: 'Tiêu chí rubric chưa gắn KC.',
}

export type SupersededKc = { kcVersionId: string; replacementVersionId: string; replacementVersionNo: number }

export type CoverageReportDto = {
  rows: {
    requirementId: string
    code791Stem: string
    bloomLevel: number | null
    choiceObservations: number
    productObservations: number
  }[]
  warnings: (CoverageWarning & { message: string; replacementVersionId?: string; replacementVersionNo?: number })[]
  blocking: boolean
  superseded: SupersededKc[]
}

function coverageDraft(draft: ModuleDraftStored): CoverageDraft {
  return {
    requirementIds: draft.requirementIds,
    items: draft.items.map((item) => {
      if (item.type === 'quiz') {
        return {
          type: 'quiz',
          purpose: item.assessment.purpose,
          questions: quizQuestions(item).map((question) => {
            const correct = new Set<string>()
            if (question.qtype === 'single_choice' && 'option' in question.answerKey) correct.add(question.answerKey.option)
            if (question.qtype === 'multi_choice' && 'options' in question.answerKey) {
              for (const option of question.answerKey.options) correct.add(option)
            }
            let unmapped = 0
            if (question.qtype === 'single_choice' || question.qtype === 'multi_choice') {
              for (const option of question.options ?? []) {
                if (correct.has(option.id)) continue
                if (!question.optionMisconceptions?.[option.id]) unmapped += 1
              }
            }
            return {
              kcObservable: question.kcObservable,
              qtype: question.qtype,
              source: question.source ?? 'teacher',
              ...(question.approvedBy ? { approvedBy: question.approvedBy } : {}),
              hints: question.hints ?? [],
              purpose: item.assessment.purpose,
              unmappedDistractors: unmapped,
            }
          }),
        }
      }
      if (item.type === 'assignment' && item.rubric) {
        return { type: 'assignment', rubric: { criteria: item.rubric.criteria.map((criterion) => ({ kcVersionId: criterion.kcVersionId })) } }
      }
      return { type: item.type }
    }),
  }
}

function referencedKcIds(draft: ModuleDraftStored): string[] {
  const ids = new Set<string>()
  for (const item of draft.items) {
    if (item.type === 'assignment' && item.rubric) {
      for (const criterion of item.rubric.criteria) if (criterion.kcVersionId) ids.add(criterion.kcVersionId)
    }
    if (item.type !== 'quiz') continue
    for (const question of quizQuestions(item)) {
      for (const id of [...question.kcObservable, ...question.kcRequired]) ids.add(id)
    }
  }
  return [...ids]
}

export async function loadStoredDraft(db: Db | Trx, moduleId: string): Promise<{ revision: number; draft: ModuleDraftStored }> {
  const row = await db.selectFrom('module_drafts').select(['revision', 'payload']).where('module_id', '=', moduleId).executeTakeFirst()
  if (!row) throw new DomainError('NOT_FOUND')
  const parsed = parseModuleDraft(row.payload, 'stored')
  if (!parsed.ok) throw new DomainError(parsed.code)
  return { revision: row.revision, draft: parsed.draft }
}

export async function coverageOf(db: Db | Trx, draft: ModuleDraftStored): Promise<CoverageReportDto> {
  const requirementIds = draft.requirementIds
  const requirements = requirementIds.length
    ? await db.selectFrom('curriculum_requirements').select(['id', 'code791_stem', 'bloom_level']).where('id', 'in', requirementIds).execute()
    : []
  const links = requirementIds.length
    ? await db
        .selectFrom('requirement_kc_links')
        .innerJoin('kc_versions', 'kc_versions.id', 'requirement_kc_links.kc_version_id')
        .select(['requirement_kc_links.requirement_id', 'requirement_kc_links.kc_version_id'])
        .where('requirement_kc_links.requirement_id', 'in', requirementIds)
        .where('requirement_kc_links.status', '=', 'approved')
        .where('kc_versions.status', '=', 'approved')
        .execute()
    : []
  const reqKcs = new Map<string, { bloom: number | null; kcs: string[] }>()
  for (const requirement of requirements) reqKcs.set(requirement.id, { bloom: requirement.bloom_level, kcs: [] })
  for (const link of links) reqKcs.get(link.requirement_id)?.kcs.push(link.kc_version_id)
  const approvedRows = await db.selectFrom('kc_versions').select('id').where('status', '=', 'approved').execute()
  const approvedKcs = new Set(approvedRows.map((row) => row.id))
  const scope = new Set(requirementIds.flatMap((id) => reqKcs.get(id)?.kcs ?? []))
  const prereqKcs = new Set<string>()
  for (const kc of scope) {
    const edges = await effectivePrerequisites(db, kc)
    for (const edge of edges) if (edge.edgeType === 'prerequisite') prereqKcs.add(edge.fromKcVersionId)
  }
  const report = computeCoverage(coverageDraft(draft), reqKcs, approvedKcs, prereqKcs)
  const referenced = referencedKcIds(draft)
  const versionRows = referenced.length
    ? await db.selectFrom('kc_versions').select(['id', 'kc_id', 'status', 'version_no']).where('id', 'in', referenced).execute()
    : []
  const superseded: SupersededKc[] = []
  for (const row of versionRows) {
    if (row.status !== 'superseded') continue
    const replacement = await db
      .selectFrom('kc_versions')
      .select(['id', 'version_no'])
      .where('kc_id', '=', row.kc_id)
      .where('status', '=', 'approved')
      .orderBy('version_no', 'desc')
      .executeTakeFirst()
    if (!replacement) continue
    superseded.push({ kcVersionId: row.id, replacementVersionId: replacement.id, replacementVersionNo: replacement.version_no })
  }
  const replacementByOld = new Map(superseded.map((row) => [row.kcVersionId, row]))
  const questionSuperseded = new Map<string, SupersededKc>()
  draft.items.forEach((item, itemIndex) => {
    if (item.type !== 'quiz') return
    quizQuestions(item).forEach((question, questionIndex) => {
      for (const kc of question.kcObservable) {
        const found = replacementByOld.get(kc)
        if (found) questionSuperseded.set(`item${itemIndex}.q${questionIndex}`, found)
      }
    })
  })
  return {
    rows: report.rows.map((row) => ({
      requirementId: row.requirementId,
      code791Stem: requirements.find((requirement) => requirement.id === row.requirementId)?.code791_stem ?? '',
      bloomLevel: row.bloom,
      choiceObservations: row.choiceObservations,
      productObservations: row.productObservations,
    })),
    warnings: report.warnings.map((warning) => {
      const replacement = questionSuperseded.get(warning.target)
      return {
        ...warning,
        message: messages[warning.code] ?? warning.code,
        ...(replacement && warning.code === 'V05'
          ? { replacementVersionId: replacement.replacementVersionId, replacementVersionNo: replacement.replacementVersionNo }
          : {}),
      }
    }),
    blocking: report.blocking,
    superseded,
  }
}

export async function validateModuleDraft(db: Db, meta: Meta, moduleId: string): Promise<CoverageReportDto> {
  await authorizeModule(db, meta.actor, moduleId, 'module.edit')
  const { draft } = await loadStoredDraft(db, moduleId)
  return coverageOf(db, draft)
}
