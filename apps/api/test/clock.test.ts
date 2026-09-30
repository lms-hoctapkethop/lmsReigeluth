import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ConfigError, loadConfig } from '../src/config.ts'

const valid = {
  APP_ORIGIN: 'http://127.0.0.1:4319',
  DATABASE_URL: 'postgres://invalid:invalid@127.0.0.1:1/none',
  OIDC_ISSUER: 'http://idp.test/realms/hcn',
  OIDC_CLIENT_ID: 'hcn-web',
  OIDC_CLIENT_SECRET: 'test-secret-hcn-web',
  COOKIE_SECRET: 'test-cookie-secret-with-32-characters',
  SESSION_TTL_HOURS: '12',
  SESSION_MAX_DAYS: '7',
  TRUST_PROXY: '',
  PORT: '4319',
}

describe('CLOCK-01', () => {
  it('CLOCK-01 production kèm HCN_NOW không khởi động được', () => {
    expect(() => loadConfig({ ...valid, NODE_ENV: 'production', HCN_NOW: '2020-01-01T00:00:00.000Z' })).toThrow(ConfigError)
    expect(() => loadConfig({ ...valid, NODE_ENV: 'production', HCN_CLOCK_FILE: '/tmp/hcn-clock' })).toThrow(/HCN_CLOCK_FILE/)
    const result = spawnSync(process.execPath, ['--experimental-strip-types', 'src/main.ts'], {
      cwd: new URL('..', import.meta.url).pathname,
      env: { ...valid, NODE_ENV: 'production', HCN_NOW: '2020-01-01T00:00:00.000Z' },
      encoding: 'utf8',
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('HCN_NOW')
  })

  it('CLOCK-01 ngoài production vẫn đọc được cấu hình', () => {
    expect(loadConfig({ ...valid, NODE_ENV: 'test', HCN_NOW: '2020-01-01T00:00:00.000Z' }).port).toBe(4319)
  })
})

describe('đồng hồ giả', () => {
  it('không đọc HCN_NOW khi không bật cờ', async () => {
    const { systemClock } = await import('@hcn/domain')
    const previous = process.env.NODE_ENV
    const now = process.env.HCN_NOW
    process.env.NODE_ENV = 'production'
    process.env.HCN_NOW = '2001-01-01T00:00:00.000Z'
    try {
      expect(systemClock.now().getFullYear()).toBeGreaterThan(2001)
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = previous
      if (now === undefined) delete process.env.HCN_NOW
      else process.env.HCN_NOW = now
    }
  })

  it('đọc tệp tối đa một lần mỗi giây', async () => {
    const { resetClockCache, systemClock } = await import('@hcn/domain')
    const dir = mkdtempSync(join(tmpdir(), 'hcn-clock-'))
    const file = join(dir, 'now')
    writeFileSync(file, '2024-01-01T00:00:00.000Z')
    const previous = process.env.NODE_ENV
    const clockFile = process.env.HCN_CLOCK_FILE
    process.env.NODE_ENV = 'test'
    process.env.HCN_CLOCK_FILE = file
    resetClockCache()
    try {
      expect(systemClock.now().toISOString()).toBe('2024-01-01T00:00:00.000Z')
      writeFileSync(file, '2024-06-01T00:00:00.000Z')
      expect(systemClock.now().toISOString()).toBe('2024-01-01T00:00:00.000Z')
      await new Promise((resolve) => setTimeout(resolve, 1100))
      expect(systemClock.now().toISOString()).toBe('2024-06-01T00:00:00.000Z')
    } finally {
      resetClockCache()
      if (previous === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = previous
      if (clockFile === undefined) delete process.env.HCN_CLOCK_FILE
      else process.env.HCN_CLOCK_FILE = clockFile
    }
  })
})
