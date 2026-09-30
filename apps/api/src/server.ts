import cookie from '@fastify/cookie'
import Fastify, { type FastifyInstance } from 'fastify'
import type { DestinationStream, Logger } from 'pino'
import type { Kysely } from 'kysely'
import type { Database } from '@hcn/db'
import type { AppConfig } from './config.ts'
import { registerAuthRoutes } from './routes/auth.ts'
import { registerMeRoutes } from './routes/me.ts'
import { registerCsrf } from './plugins/csrf.ts'
import { registerErrorHandler } from './plugins/error-handler.ts'
import { registerGuard } from './plugins/guard.ts'
import { createLogger, loggedUrl } from './plugins/logger.ts'
import { registerRateLimit } from './plugins/rate-limit.ts'
import { requestIdFrom, registerRequestId } from './plugins/request-id.ts'
import { registerSession } from './plugins/session.ts'
import './types.ts'

export type BuildAppOptions = {
  config: AppConfig
  db: Kysely<Database>
  logStream?: DestinationStream
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const logger: Logger = createLogger(options.logStream)
  const app = Fastify({
    trustProxy: options.config.trustProxy.length > 0 ? options.config.trustProxy.join(',') : false,
    genReqId: requestIdFrom,
    logger: false,
  })
  const registeredRoutes: { method: string; url: string; isPublic: boolean }[] = []
  app.decorate('registeredRoutes', registeredRoutes)
  app.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method]
    for (const method of methods) {
      registeredRoutes.push({ method, url: route.url, isPublic: route.config?.public === true })
    }
  })
  await app.register(cookie)
  registerRequestId(app)
  registerSession(app, options.db, options.config)
  await registerRateLimit(app)
  registerCsrf(app, options.config)
  registerGuard(app)
  registerErrorHandler(app)
  app.addHook('onResponse', async (request, reply) => {
    const path = request.url.split('?')[0] ?? request.url
    logger.info(
      {
        request_id: request.id,
        route: request.routeOptions.url ?? path,
        url: loggedUrl(request.url),
        status: reply.statusCode,
        duration_ms: Math.round(reply.elapsedTime),
        actor_id: request.auth?.userId ?? null,
        school_id: request.auth?.schoolId ?? null,
      },
      'request',
    )
  })
  app.get('/health/live', { config: { public: true } }, async () => ({ status: 'live' }))
  registerAuthRoutes(app, options.db, options.config)
  registerMeRoutes(app, options.db)
  return app
}
