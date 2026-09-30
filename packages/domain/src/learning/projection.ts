const hiddenQuestionKeys = new Set([
  'answerKey',
  'rationale',
  'optionMisconceptions',
  'kcRequired',
  'source',
  'approvedBy',
  'provisional',
])

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function projectQuestion(value: unknown): Record<string, unknown> {
  const row = asRecord(value) ?? {}
  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(row)) {
    if (hiddenQuestionKeys.has(key)) continue
    out[key] = child
  }
  return out
}

function projectItem(value: unknown): unknown {
  const item = asRecord(value)
  if (!item) return value
  if (item.type !== 'quiz') return item
  const assessment = asRecord(item.assessment)
  if (!assessment) return item
  const questions = Array.isArray(assessment.questions) ? assessment.questions.map(projectQuestion) : []
  return { ...item, assessment: { ...assessment, questions } }
}

/**
 * Chiếu bản nháp hoặc payload cùng hình dạng sang DTO học sinh.
 * M4 dùng cho xem trước. M5 phải gọi lại đúng hàm này, không viết bản sao.
 */
export function toLearnerRelease(draftOrVersion: unknown): Record<string, unknown> {
  const root = asRecord(draftOrVersion) ?? {}
  const source = Array.isArray(root.items) ? root : (asRecord(root.payload) ?? root)
  const items = Array.isArray(source.items) ? source.items.map(projectItem) : []
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(source)) {
    if (key === 'items') continue
    out[key] = value
  }
  out.items = items
  return out
}
