import type { FastifyInstance } from 'fastify'
import type { Kysely } from 'kysely'
import { switchContextBody } from '@hcn/contracts'
import type { Database } from '@hcn/db'
import { DomainError, getMe, switchContext } from '@hcn/domain'
import { writeRateLimit } from '../plugins/rate-limit.ts'

export function registerMeRoutes(app: FastifyInstance, db: Kysely<Database>): void {
  app.get('/api/v1/me', async (request) => {
    if (!request.auth) throw new DomainError('UNAUTHENTICATED')
    return getMe(
      db,
      { userId: request.auth.userId, schoolId: request.auth.schoolId, roles: [request.auth.role] },
      request.auth.displayName,
      request.auth.csrfToken,
    )
  })

  app.post('/api/v1/me/context', { config: { rateLimit: writeRateLimit } }, async (request) => {
    if (!request.auth) throw new DomainError('UNAUTHENTICATED')
    const parsed = switchContextBody.safeParse(request.body)
    if (!parsed.success) throw parsed.error
    return switchContext(
      db,
      { userId: request.auth.userId, schoolId: request.auth.schoolId, roles: [request.auth.role] },
      request.auth.sessionHash,
      request.auth.displayName,
      request.auth.csrfToken,
      parsed.data,
      request.id,
    )
  })
}
