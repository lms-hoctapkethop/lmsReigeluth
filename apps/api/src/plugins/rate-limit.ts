import rateLimit from '@fastify/rate-limit'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { DomainError } from '@hcn/domain'

export const authRateLimit = {
  max: 20,
  timeWindow: '1 minute',
  groupId: 'auth',
  keyGenerator: (request: FastifyRequest) => request.ip,
}

export const writeRateLimit = {
  max: 120,
  timeWindow: '1 minute',
  groupId: 'write',
  keyGenerator: (request: FastifyRequest) => request.auth?.userId ?? request.ip,
}

export const importRateLimit = {
  max: 5,
  timeWindow: '1 hour',
  groupId: 'import-users',
  keyGenerator: (request: FastifyRequest) => request.auth?.schoolId ?? request.ip,
}

export async function registerRateLimit(app: FastifyInstance): Promise<void> {
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: () => new DomainError('RATE_LIMITED'),
  })
}
