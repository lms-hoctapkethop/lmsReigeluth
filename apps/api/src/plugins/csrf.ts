import { timingSafeEqual } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { DomainError } from '@hcn/domain'
import type { AppConfig } from '../config.ts'

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS'])

function tokensMatch(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export function registerCsrf(app: FastifyInstance, config: AppConfig): void {
  app.addHook('preHandler', async (request) => {
    if (safeMethods.has(request.method)) return
    if (!request.auth) return
    const header = request.headers['x-csrf-token']
    const token = Array.isArray(header) ? header[0] : header
    const origin = request.headers.origin
    const tokenOk = typeof token === 'string' && tokensMatch(token, request.auth.csrfToken)
    const originOk = origin === config.appOrigin
    if (!tokenOk || !originOk) throw new DomainError('CSRF_FAILED')
  })
}
