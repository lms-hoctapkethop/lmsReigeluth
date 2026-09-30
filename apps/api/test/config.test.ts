import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ConfigError, loadConfig } from '../src/config.ts'

const base = {
  APP_ORIGIN: 'http://127.0.0.1:4319',
  DATABASE_URL: 'postgres://hcn:hcn@127.0.0.1:5432/hcn',
  OIDC_ISSUER: 'http://127.0.0.1:9/realms/hcn',
  OIDC_CLIENT_ID: 'hcn-web',
  OIDC_CLIENT_SECRET: 'test-secret',
  COOKIE_SECRET: 'test-cookie-secret-with-32-characters',
}

describe('cấu hình', () => {
  it('đọc secret từ tệp và báo tên biến khi sai', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hcn-config-'))
    const file = join(dir, 'cookie')
    writeFileSync(file, '  test-cookie-secret-with-32-characters\n')
    const withoutCookie: NodeJS.ProcessEnv = { ...base }
    withoutCookie.COOKIE_SECRET = undefined
    const loaded = loadConfig({ ...withoutCookie, COOKIE_SECRET_FILE: file })
    expect(loaded.cookieSecret).toBe('test-cookie-secret-with-32-characters')

    expect(() => loadConfig({ ...base, COOKIE_SECRET_FILE: file })).toThrow(ConfigError)
    try {
      loadConfig({ ...base, COOKIE_SECRET_FILE: file })
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError)
      expect((error as Error).message).toContain('COOKIE_SECRET')
      expect((error as Error).message).not.toContain('test-cookie-secret')
    }

    expect(() => loadConfig({ ...base, COOKIE_SECRET: 'ngan' })).toThrow(/COOKIE_SECRET/)
    expect(() => loadConfig({ ...base, TRUST_PROXY: 'not-a-cidr' })).toThrow(/TRUST_PROXY/)
  })
})
