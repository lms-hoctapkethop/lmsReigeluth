export type NormalizeResult =
  | { ok: true; value: number }
  | {
      ok: false
      reason: 'not_string' | 'empty' | 'division_by_zero' | 'ambiguous_separator' | 'unparseable'
    }

export function normalizeNumber(raw: unknown): NormalizeResult {
  if (typeof raw !== 'string') return { ok: false, reason: 'not_string' }
  let s = raw.trim().replace(/−/g, '-').replace(/\s+/g, '')
  if (s === '') return { ok: false, reason: 'empty' }
  const frac = s.match(/^(-?)(\d+(?:[.,]\d+)?)\/(\d+(?:[.,]\d+)?)$/)
  if (frac) {
    const left = frac[2]
    const right = frac[3]
    if (left === undefined || right === undefined) return { ok: false, reason: 'unparseable' }
    const a = Number(left.replace(',', '.'))
    const b = Number(right.replace(',', '.'))
    if (b === 0) return { ok: false, reason: 'division_by_zero' }
    return { ok: true, value: (frac[1] ? -1 : 1) * a / b }
  }
  if (/^-?[1-9]\d{0,2}\.\d{3}$/.test(s)) return { ok: false, reason: 'ambiguous_separator' }
  if (/^-?\d+,\d+$/.test(s)) s = s.replace(',', '.')
  if (!/^-?\d+(\.\d+)?$/.test(s)) return { ok: false, reason: 'unparseable' }
  return { ok: true, value: Number(s) }
}
