import { round4 } from '../round.ts'

export const R0_MODEL_VERSION = 'R0@1.0.0'
export const R0_VERSION = R0_MODEL_VERSION

export type R0Observation = {
  sourceType: 'review' | 'diagnostic' | 'practice' | 'exit_ticket'
  weight: number
  score: number
  hintsUsed: number
  observedAt: string
}

export type R0Estimate = {
  status: 'insufficient' | 'needs_support' | 'strong' | 'developing'
  value: number | null
  n: number
}

export function r0Estimate(obs: R0Observation[]): R0Estimate {
  const n = obs.length
  if (n < 2) return { status: 'insufficient', value: null, n }
  const weight = obs.reduce((sum, item) => sum + item.weight, 0)
  const value = round4(obs.reduce((sum, item) => sum + item.weight * item.score, 0) / weight)
  const sorted = [...obs].sort((left, right) => left.observedAt.localeCompare(right.observedAt))
  const lastReview = [...sorted].reverse().find((item) => item.sourceType === 'review')
  const hasNonHint = obs.some((item) => !(item.sourceType === 'practice' && item.hintsUsed > 0))
  if (value < 0.5 || (lastReview && lastReview.score < 0.5)) return { status: 'needs_support', value, n }
  if (value >= 0.8 && n >= 3 && hasNonHint) return { status: 'strong', value, n }
  return { status: 'developing', value, n }
}
