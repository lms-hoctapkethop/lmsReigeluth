import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { Kysely } from 'kysely'
import type { Database } from '@hcn/db'
import { DomainError, getOffering, listMyOfferings, systemClock, type Actor } from '@hcn/domain'

function meta(request: FastifyRequest): { actor: Actor; requestId: string; clock: typeof systemClock } {
  if (!request.auth) throw new DomainError('UNAUTHENTICATED')
  return {
    actor: { userId: request.auth.userId, schoolId: request.auth.schoolId, roles: [request.auth.role] },
    requestId: request.id,
    clock: systemClock,
  }
}

export function registerOfferingRoutes(app: FastifyInstance, db: Kysely<Database>): void {
  app.get('/api/v1/offerings', async (request) => listMyOfferings(db, meta(request)))
  app.get<{ Params: { offeringId: string } }>('/api/v1/offerings/:offeringId', async (request) =>
    getOffering(db, meta(request), request.params.offeringId),
  )
}
