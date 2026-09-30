import { normalizeNumber } from './normalize.ts'
import { round3 } from '../round.ts'

export type GradeResult = { correct: boolean | null; score: number }

type AnswerKey = {
  option?: string
  options?: string[]
  scoring?: string
  value?: string
  accept?: string[]
  tolerance?: string
  manual?: boolean
  caseSensitive?: boolean
}

type ResponseBody = {
  option?: string
  options?: unknown
  raw?: string
}

export function gradeResponse(qtype: string, key: AnswerKey, response: ResponseBody | null): GradeResult {
  switch (qtype) {
    case 'single_choice': {
      if (typeof response?.option !== 'string') throw new Error('VALIDATION_FAILED')
      const correct = response.option === key.option
      return { correct, score: correct ? 1 : 0 }
    }
    case 'multi_choice': {
      if (!Array.isArray(response?.options)) throw new Error('VALIDATION_FAILED')
      const picked = new Set(response.options)
      const want = new Set(key.options ?? [])
      const tp = [...picked].filter((option) => want.has(option)).length
      const fp = picked.size - tp
      const exact = tp === want.size && fp === 0
      if (key.scoring === 'partial') {
        const score = Math.max(0, (tp - fp) / want.size)
        return { correct: exact, score: round3(score) }
      }
      return { correct: exact, score: exact ? 1 : 0 }
    }
    case 'numeric': {
      const parsed = normalizeNumber(response?.raw)
      if (!parsed.ok) throw new Error('VALIDATION_FAILED')
      const targets = [key.value, ...(key.accept ?? [])]
        .map((value) => (value === undefined ? null : normalizeNumber(value)))
        .filter((item): item is { ok: true; value: number } => item !== null && item.ok)
        .map((item) => item.value)
      let tol = 0
      if (key.tolerance) {
        const parsedTol = normalizeNumber(key.tolerance)
        tol = parsedTol.ok ? parsedTol.value : Number.NaN
      }
      const ok = targets.some((target) => Math.abs(target - parsed.value) <= tol + 1e-9)
      return { correct: ok, score: ok ? 1 : 0 }
    }
    case 'short_text': {
      if (typeof response?.raw !== 'string') throw new Error('VALIDATION_FAILED')
      if (key.manual) return { correct: null, score: 0 }
      const norm = (value: string) => (key.caseSensitive ? value : value.toLowerCase()).trim().replace(/\s+/g, ' ')
      const ok = (key.accept ?? []).map(norm).includes(norm(response.raw))
      return { correct: ok, score: ok ? 1 : 0 }
    }
    default:
      throw new Error('UNKNOWN_QTYPE')
  }
}
