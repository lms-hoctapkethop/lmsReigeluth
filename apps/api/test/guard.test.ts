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

describe('mặc định từ chối', () => {
  it('route không public không trả 200 khi không có phiên', async () => {
    const app = await buildApp({ config, db: {} as Kysely<Database> })
    const protectedRoutes = app.registeredRoutes.filter((route) => !route.isPublic)
    expect(protectedRoutes.length).toBeGreaterThan(0)
    for (const route of protectedRoutes) {
      const response = await app.inject({ method: route.method as 'GET', url: route.url })
      expect(response.statusCode, `${route.method} ${route.url}`).not.toBe(200)
    }
    await app.close()
  })
})
