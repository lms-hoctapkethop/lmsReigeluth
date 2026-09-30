import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/main.ts'

describe('health', () => {
  it('GET /health/live returns live', async () => {
    const app = buildApp()
    const response = await app.inject({ method: 'GET', url: '/health/live' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'live' })
    await app.close()
  })
})
