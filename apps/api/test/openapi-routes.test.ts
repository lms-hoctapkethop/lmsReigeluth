import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { createDb } from '@hcn/db'
import { errorCodes } from '@hcn/domain'
import { describe, expect, it } from 'vitest'
import type { AppConfig } from '../src/config.ts'
import { buildApp } from '../src/server.ts'

const httpMethods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])

function normalize(url: string): string {
  return url.replace(/:([A-Za-z0-9_]+)/g, '{$1}')
}

describe('OA-02', () => {
  it('OA-02 route đã đăng ký khớp paths của OpenAPI, bỏ qua x-milestone', async () => {
    const config: AppConfig = {
      appOrigin: 'http://127.0.0.1:4319',
      databaseUrl: 'postgres://invalid:invalid@127.0.0.1:1/none',
      oidcIssuer: 'http://idp.test/realms/hcn',
      oidcClientId: 'hcn-web',
      oidcClientSecret: 'test-secret-hcn-web',
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
    const db = createDb(config.databaseUrl)
    const app = await buildApp({ config, db })
    const registered = new Set(
      app.registeredRoutes
        .filter((route) => httpMethods.has(route.method.toUpperCase()))
        .filter((route) => route.url.startsWith('/api/v1/') || route.url.startsWith('/auth/') || route.url.startsWith('/health/'))
        .map((route) => `${route.method.toUpperCase()} ${normalize(route.url)}`),
    )
    const document = parse(readFileSync(new URL('../../../openapi/openapi.yaml', import.meta.url), 'utf8'), { uniqueKeys: true }) as {
      paths: Record<string, Record<string, { 'x-milestone'?: string }>>
    }
    const documented = new Set<string>()
    for (const [path, item] of Object.entries(document.paths)) {
      for (const [method, operation] of Object.entries(item)) {
        if (!httpMethods.has(method.toUpperCase())) continue
        if (operation?.['x-milestone']) continue
        documented.add(`${method.toUpperCase()} ${path}`)
      }
    }
    const missingInOpenApi = [...registered].filter((route) => !documented.has(route)).sort()
    const missingInApp = [...documented].filter((route) => !registered.has(route)).sort()
    expect({ missingInOpenApi, missingInApp }).toEqual({ missingInOpenApi: [], missingInApp: [] })
    await app.close()
    await db.destroy()
  })
})

describe('OA-03', () => {
  it('OA-03 mã trong errors.ts khớp enum ErrorResponse.code hai chiều', () => {
    const document = parse(readFileSync(new URL('../../../openapi/openapi.yaml', import.meta.url), 'utf8'), { uniqueKeys: true }) as {
      components: { schemas: { ErrorResponse: { properties: { error: { properties: { code: { enum: string[] } } } } } } }
    }
    const documented = document.components.schemas.ErrorResponse.properties.error.properties.code.enum
    expect([...documented].sort()).toEqual([...errorCodes].sort())
  })
})