import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const src = fileURLToPath(new URL('..', import.meta.url))

function filesIn(dir: string): string[] {
  if (!existsSync(dir)) return []
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) found.push(...filesIn(path))
    else if (entry.endsWith('.ts')) found.push(path)
  }
  return found
}

describe('B04 phần M3', () => {
  it('assessment, needs và path không import hàm đọc cạnh proposed', () => {
    const offenders: string[] = []
    for (const name of ['assessment', 'needs', 'path']) {
      for (const file of filesIn(join(src, name))) {
        const text = readFileSync(file, 'utf8')
        if (text.includes('proposedEdgesForReview')) offenders.push(file)
      }
    }
    expect(offenders).toEqual([])
  })

  it('chỉ lớp chuyên môn gọi proposedEdgesForReview', () => {
    const text = readFileSync(join(src, 'curriculum/listKcEdges.ts'), 'utf8')
    expect(text).toContain('proposedEdgesForReview')
    expect(text).toContain('effectivePrerequisites')
  })
})
