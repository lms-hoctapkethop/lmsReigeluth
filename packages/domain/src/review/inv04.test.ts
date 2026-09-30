import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name === 'dist' || name === 'coverage') return []
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return walk(path)
    return path.endsWith('.ts') || path.endsWith('.tsx') ? [path] : []
  })
}

describe('INV-04', () => {
  it('INV-04 chỉ publishReview và supersedeDecision ghi attainment_decisions', () => {
    const root = process.cwd()
    const sources = [...walk(join(root, 'packages')), ...walk(join(root, 'apps'))]
    const inserts: string[] = []
    const imports: string[] = []
    for (const path of sources) {
      const text = readFileSync(path, 'utf8')
      const rel = relative(root, path)
      if (rel.endsWith('.test.ts')) continue
      if (/insertInto\(\s*['"]attainment_decisions['"]/.test(text) || /INSERT INTO attainment_decisions/i.test(text)) inserts.push(rel)
      if (/from ['"](?:\.\/decisions\.ts|\.\.\/review\/decisions\.ts|\.\/review\/decisions\.ts)['"]/.test(text)) imports.push(rel)
    }
    expect(inserts.sort()).toEqual(['packages/domain/src/review/decisions.ts'])
    expect(imports.sort()).toEqual(['packages/domain/src/review/publish.ts', 'packages/domain/src/review/supersede.ts'])
  })
})
