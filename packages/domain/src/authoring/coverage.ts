export type CoverageQuestion = {
  kcObservable: string[]
  qtype: string
  source: string
  approvedBy?: string
  hints?: string[]
  purpose?: string
  unmappedDistractors?: number
}

export type CoverageItem = {
  type: string
  purpose?: string
  questions?: CoverageQuestion[]
  rubric?: { criteria: { kcVersionId: string | null }[] }
}

export type CoverageDraft = {
  requirementIds: string[]
  items: CoverageItem[]
}

export type CoverageWarning = { code: string; level: 'block' | 'caution' | 'info'; target: string }

export function computeCoverage(
  draft: CoverageDraft,
  reqKcs: Map<string, { bloom: number | null; kcs: string[] }>,
  approvedKcs: Set<string>,
): { rows: { requirementId: string; bloom: number | null; choiceObservations: number; productObservations: number }[]; warnings: CoverageWarning[]; blocking: boolean } {
  const warnings: CoverageWarning[] = []
  const rows = draft.requirementIds.map((rid) => {
    const requirement = reqKcs.get(rid) ?? { bloom: null, kcs: [] }
    let choice = 0
    let product = 0
    for (const item of draft.items) {
      for (const question of item.questions ?? []) {
        if (question.kcObservable.some((kc) => requirement.kcs.includes(kc))) choice += 1
      }
      for (const criterion of item.rubric?.criteria ?? []) {
        if (criterion.kcVersionId && requirement.kcs.includes(criterion.kcVersionId)) product += 1
      }
    }
    if (choice + product === 0) warnings.push({ code: 'V01', level: 'block', target: rid })
    else if ((requirement.bloom ?? 0) >= 5 && product === 0) warnings.push({ code: 'V02', level: 'caution', target: rid })
    return { requirementId: rid, bloom: requirement.bloom, choiceObservations: choice, productObservations: product }
  })
  const scopeKcs = new Set(draft.requirementIds.flatMap((rid) => reqKcs.get(rid)?.kcs ?? []))
  draft.items.forEach((item, i) => {
    ;(item.questions ?? []).forEach((question, j) => {
      const target = `item${i}.q${j}`
      if (item.purpose === 'practice' && (question.hints ?? []).length === 0) {
        warnings.push({ code: 'V03', level: 'caution', target })
      }
      if ((question.qtype === 'single_choice' || question.qtype === 'multi_choice') && (question.unmappedDistractors ?? 0) > 0) {
        warnings.push({ code: 'V04', level: 'info', target })
      }
      if (question.kcObservable.some((kc) => !approvedKcs.has(kc) || !scopeKcs.has(kc))) {
        warnings.push({ code: 'V05', level: 'block', target })
      }
      if (question.source === 'ai_proposal' && !question.approvedBy) warnings.push({ code: 'V07', level: 'block', target })
    })
    ;(item.rubric?.criteria ?? []).forEach((criterion, j) => {
      if (!criterion.kcVersionId) warnings.push({ code: 'V08', level: 'caution', target: `item${i}.c${j}` })
    })
  })
  return { rows, warnings, blocking: warnings.some((warning) => warning.level === 'block') }
}
