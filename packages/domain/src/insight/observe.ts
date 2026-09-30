import { round3 } from '../round.ts'

export const WEIGHTS = {
  review: 1.0,
  diagnostic: 0.7,
  exit_ticket: 0.7,
  practice: 0.6,
  practice_hint: 0.3,
  practice_retry: 0.2,
} as const

export type ResponseObservation = {
  purpose: string
  tryNo: number
  hintsUsed: number
  correct: boolean | null
  score: number
  provisionalItem?: boolean
}

export function observationFromResponse(input: ResponseObservation): { weight: number; score: number } | null {
  if (input.correct === null) return null
  if (input.purpose === 'self_assessment' || input.purpose === 'summative') return null
  let weight: number
  if (input.purpose === 'practice') {
    if (input.tryNo > 3) return null
    weight = input.tryNo >= 3 ? WEIGHTS.practice_retry : input.hintsUsed > 0 ? WEIGHTS.practice_hint : WEIGHTS.practice
  } else {
    const known = WEIGHTS[input.purpose as keyof typeof WEIGHTS]
    weight = known
  }
  if (input.provisionalItem) weight = weight / 2
  return { weight: round3(weight), score: round3(input.score) }
}

export function observationFromCriterion(
  level: string,
  kcVersionId: string | null,
): { weight: number; score: number } | null {
  if (!kcVersionId || level === 'not_shown') return null
  const scores: Record<string, number> = { meets: 1, developing: 0.5, not_yet: 0 }
  const score = scores[level]
  if (score === undefined) throw new Error('VALIDATION_FAILED')
  return { weight: WEIGHTS.review, score }
}
