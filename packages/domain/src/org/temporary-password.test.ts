import { randomInt } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { temporaryPassword, temporaryPasswordAlphabet } from './temporary-password.ts'

describe('mật khẩu tạm', () => {
  it('12 ký tự, crypto.randomInt, bỏ 0 O 1 l I', () => {
    for (let index = 0; index < 20; index += 1) {
      const value = temporaryPassword()
      expect(value).toHaveLength(12)
      expect(randomInt(temporaryPasswordAlphabet.length)).toBeGreaterThanOrEqual(0)
      for (const char of value) expect(temporaryPasswordAlphabet.includes(char)).toBe(true)
      expect(value).not.toMatch(/[0O1lI]/)
    }
  })
})
