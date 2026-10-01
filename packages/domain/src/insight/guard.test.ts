import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { featureAiEnabled } from './feature.ts'

function filesUnder(dir: string): string[] {
  const found: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) found.push(...filesUnder(path))
    else if (name.endsWith('.ts')) found.push(path)
  }
  return found
}

describe('A16', () => {
  it('A16 mã insight không import repository review, decision, release', () => {
    const roots = [
      join(import.meta.dirname, '.'),
      join(import.meta.dirname, '../../../../apps/worker/src/insight'),
    ]
    const banned = /from ['"][^'"]*(review\/|release\/|quiz\/keys|decisions)/
    for (const path of roots.flatMap((root) => filesUnder(root))) {
      if (path.endsWith('guard.test.ts')) continue
      expect(readFileSync(path, 'utf8'), path).not.toMatch(banned)
    }
  })
})

describe('FEATURE_AI', () => {
  it('mặc định tắt', () => {
    expect(featureAiEnabled({})).toBe(false)
    expect(featureAiEnabled({ FEATURE_AI: 'false' })).toBe(false)
    expect(featureAiEnabled({ FEATURE_AI: 'true' })).toBe(true)
  })
})
