import { randomUUID } from 'node:crypto'
import type { IncomingHttpHeaders } from 'node:http'
import type { FastifyInstance } from 'fastify'

const requestIdPattern = /^[A-Za-z0-9-]{8,64}$/

export function requestIdFrom(request: { headers: IncomingHttpHeaders }): string {
  const header = request.headers['x-request-id']
  const value = Array.isArray(header) ? header[0] : header
  if (value && requestIdPattern.test(value)) return value
  return randomUUID()
}

export function registerRequestId(app: FastifyInstance): void {
  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Request-Id', request.id)
  })
}
