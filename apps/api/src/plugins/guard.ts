import type { FastifyInstance } from 'fastify'
import { DomainError } from '@hcn/domain'

export function registerGuard(app: FastifyInstance): void {
  app.addHook('onSend', async (request, reply, payload) => {
    const path = request.url.split('?')[0] ?? request.url
    if (path.startsWith('/auth/') || path.startsWith('/api/v1/me')) {
      reply.header('Cache-Control', 'no-store')
    }
    return payload
  })
  app.addHook('preHandler', async (request) => {
    const route = request.routeOptions.url ?? ''
    if (!route.startsWith('/api/v1')) return
    if (request.routeOptions.config.public) return
    if (!request.auth) throw new DomainError('UNAUTHENTICATED')
  })
}
