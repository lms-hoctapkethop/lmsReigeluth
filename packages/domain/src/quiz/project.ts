export const numericFormatMessage = 'Em nhập số thập phân bằng dấu phẩy, ví dụ 1,5'

export type Purpose = 'diagnostic' | 'practice' | 'exit_ticket' | 'self_assessment' | 'summative'
export type ShowFeedback = 'immediate' | 'after_submit' | 'after_due' | 'never'

export type LearnerOption = { id: string; label: string }

export type RawQuestion = {
  id: string
  qtype: 'single_choice' | 'multi_choice' | 'numeric' | 'short_text'
  stem: unknown
  options: unknown
  bloomTarget: number
  hints: unknown
}

export type RawResponse = {
  questionId: string
  tryNo: number
  response: unknown
  correct: boolean | null
  hintsUsed: number
  feedback: string | null
}

export type RawHint = { questionId: string; hintsUsed: number }

export function asOptions(value: unknown): LearnerOption[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const row = item as Record<string, unknown>
    if (typeof row.id !== 'string' || typeof row.label !== 'string') return []
    return [{ id: row.id, label: row.label }]
  })
}

export function hintTexts(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function orderOptions(options: LearnerOption[], order: string[] | undefined): LearnerOption[] {
  if (!order || order.length === 0) return options
  const byId = new Map(options.map((option) => [option.id, option]))
  const ranked = order.flatMap((id) => {
    const option = byId.get(id)
    return option ? [option] : []
  })
  for (const option of options) {
    if (!order.includes(option.id)) ranked.push(option)
  }
  return ranked
}

export function feedbackVisible(input: {
  purpose: Purpose
  showFeedback: ShowFeedback
  status: 'in_progress' | 'submitted'
  dueAt: Date | null
  now: Date
}): boolean {
  if (input.purpose === 'practice') return true
  if (input.showFeedback === 'never') return false
  if (input.showFeedback === 'immediate') return true
  if (input.status !== 'submitted') return false
  if (input.showFeedback === 'after_submit') return true
  return input.dueAt !== null && input.now.getTime() > input.dueAt.getTime()
}

export type AnswerFields = {
  questionId: string
  tryNo: number
  correct: boolean | null
  feedback: string | null
  misconceptionCode: string | null
  hintsUsed: number
  revealed: boolean
}

/**
 * Hàm duy nhất chiếu LearnerQuestion, Attempt và AnswerResult.
 * Không nhận answerKey, rationale, optionMisconceptions, kcRequired, kcObservable.
 */
export function toLearnerAttempt(input: {
  id: string
  purpose: Purpose
  attemptNo: number
  status: 'in_progress' | 'submitted'
  score: number | null
  maxScore: number | null
  optionOrder: Record<string, string[]> | null
  questions: RawQuestion[]
  responses: RawResponse[]
  hints: RawHint[]
  revealed: (questionId: string) => boolean
  answer?: AnswerFields
}): { attempt: Record<string, unknown>; answer: Record<string, unknown> | null } {
  const last = new Map<string, RawResponse>()
  for (const row of input.responses) {
    const current = last.get(row.questionId)
    if (!current || row.tryNo >= current.tryNo) last.set(row.questionId, row)
  }
  const hintCount = new Map(input.hints.map((row) => [row.questionId, row.hintsUsed]))
  const questions = input.questions.map((question) => {
    const hints = hintTexts(question.hints)
    const options = orderOptions(asOptions(question.options), input.optionOrder?.[question.id])
    const view: Record<string, unknown> = {
      id: question.id,
      qtype: question.qtype,
      stem: question.stem,
      bloomTarget: question.bloomTarget,
      hintsAvailable: hints.length,
    }
    if (options.length > 0) view.options = options.map((option) => ({ id: option.id, label: option.label }))
    return view
  })
  const questionStates = input.questions.map((question) => {
    const response = last.get(question.id)
    const hints = hintTexts(question.hints)
    const used = hintCount.get(question.id) ?? response?.hintsUsed ?? 0
    const revealed = input.revealed(question.id) && Boolean(response)
    const state: Record<string, unknown> = {
      questionId: question.id,
      answered: Boolean(response),
      tryNo: response ? response.tryNo : null,
      hintsUsed: used,
      revealed,
      openedHints: hints.slice(0, used),
    }
    if (revealed && response) {
      state.correct = response.correct
      state.feedback = response.feedback
    }
    return state
  })
  const attempt: Record<string, unknown> = {
    id: input.id,
    purpose: input.purpose,
    attemptNo: input.attemptNo,
    status: input.status,
    questions,
    answered: input.questions.filter((question) => last.has(question.id)).map((question) => question.id),
    questionStates,
    score: input.status === 'submitted' ? input.score : null,
    maxScore: input.status === 'submitted' ? input.maxScore : null,
  }
  if (!input.answer) return { attempt, answer: null }
  return {
    attempt,
    answer: {
      tryNo: input.answer.tryNo,
      revealed: input.answer.revealed,
      correct: input.answer.revealed ? input.answer.correct : null,
      feedback: input.answer.revealed ? input.answer.feedback : null,
      misconceptionCode: input.answer.revealed ? input.answer.misconceptionCode : null,
      hintsUsed: input.answer.hintsUsed,
    },
  }
}
