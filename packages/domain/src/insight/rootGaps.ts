export type RootGap = { root: string; affected: string[]; capped: boolean }

export function rootGaps(
  prereq: Map<string, string[]>,
  status: Map<string, string>,
  maxDepth = 3,
): RootGap[] {
  const groups = new Map<string, RootGap>()
  for (const [kc, state] of status) {
    if (state !== 'needs_support') continue
    let cur = kc
    let depth = 0
    let capped = false
    while (true) {
      const weak = (prereq.get(cur) ?? []).filter((item) => status.get(item) === 'needs_support').sort()
      if (weak.length === 0) break
      if (depth === maxDepth) {
        capped = true
        break
      }
      const next = weak[0]
      if (next === undefined) break
      cur = next
      depth += 1
    }
    const existing = groups.get(cur) ?? { root: cur, affected: [], capped: false }
    existing.affected.push(kc)
    existing.capped = existing.capped || capped
    groups.set(cur, existing)
  }
  return [...groups.values()]
    .map((group) => ({ ...group, affected: group.affected.sort() }))
    .sort((left, right) => left.root.localeCompare(right.root))
}
