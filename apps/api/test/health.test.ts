import { describe, expect, it } from 'vitest'
import type { Kysely } from 'kysely'
import type { Database } from '@hcn/db'
import type { AppConfig } from '../src/config.ts'
import { buildApp } from '../src/server.ts'

const config: AppConfig = {
  appOrigin: 'http://127.0.0.1:4319',
  databaseUrl: 'postgres://hcn:hcn@127.0.0.1:5432/hcn',
  oidcIssuer: 'http://127.0.0.1:9/realms/hcn',
  oidcClientId: 'hcn-web',
  oidcClientSecret: 'test-secret',
  cookieSecret: 'test-cookie-secret-with-32-characters',
  sessionTtlHours: 12,
  sessionMaxDays: 7,
  trustProxy: [],
  port: 4319,
    hcnEnv: 'development',
    metricsPort: 9464,
    backupMetricsFile: '/run/hcn-metrics/backup.prom',
    faultAfterCommit: null,
}

describe('health', () => {
  it('GET /health/live returns live', async () => {
    const app = await buildApp({ config, db: {} as Kysely<Database> })
    const response = await app.inject({ method: 'GET', url: '/health/live' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'live' })
    await app.close()
  })

  it('GET /health/ready trả 503 không kèm chi tiết khi DB và OIDC không tới được', async () => {
    const app = await buildApp({ config, db: {} as Kysely<Database> })
    const response = await app.inject({ method: 'GET', url: '/health/ready' })
    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ status: 'not_ready', checks: { db: 'fail', oidc: 'fail' } })
    expect(response.body).not.toContain('ECONN')
    await app.close()
  })

  it('GET /api/v1/runtime trả môi trường', async () => {
    const app = await buildApp({ config: { ...config, hcnEnv: 'staging' }, db: {} as Kysely<Database> })
    const response = await app.inject({ method: 'GET', url: '/api/v1/runtime' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ env: 'staging' })
    await app.close()
  })

  it('không tin X-Forwarded-For khi peer không thuộc TRUST_PROXY', async () => {
    const app = await buildApp({
      config: { ...config, trustProxy: ['172.30.18.0/24'] },
      db: {} as Kysely<Database>,
    })
    let last = 0
    for (let attempt = 0; attempt < 21; attempt += 1) {
      const response = await app.inject({
        method: 'GET',
        url: '/auth/login',
        headers: { 'x-forwarded-for': `203.0.113.${attempt + 1}` },
      })
      last = response.statusCode
    }
    expect(last).toBe(429)
    await app.close()
  })
})
