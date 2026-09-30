import type { ModuleDraftStored } from '@hcn/contracts'

/** Câu trong ModuleDraft. Zod generic làm questions thành unknown; ép một lần ở biên. */
export type StoredQuestion = {
  clientKey: string
  qtype: 'single_choice' | 'multi_choice' | 'numeric' | 'short_text'
  stem: unknown
  options?: { id: string; label: string }[]
  answerKey: { option?: string; options?: string[]; scoring?: string; value?: string; tolerance?: string; accept?: string[]; caseSensitive?: boolean; manual?: boolean; unit?: string | null }
  rationale?: unknown
  kcRequired: string[]
  kcObservable: string[]
  bloomTarget: number
  variantGroup?: string
  difficultyPrior?: 'easy' | 'medium' | 'hard'
  hints?: string[]
  optionMisconceptions?: Record<string, string>
  source?: 'teacher' | 'library' | 'ai_proposal' | 'import'
  approvedBy?: string | null
  provisional?: boolean
}

export type StoredItem = ModuleDraftStored['items'][number]

export function quizQuestions(item: StoredItem): StoredQuestion[] {
  if (item.type !== 'quiz') return []
  return item.assessment.questions as StoredQuestion[]
}
