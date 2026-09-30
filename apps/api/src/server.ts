import cookie from '@fastify/cookie'
import multipart from '@fastify/multipart'
import Fastify, { type FastifyInstance } from 'fastify'
import type { DestinationStream, Logger } from 'pino'
import type { Kysely } from 'kysely'
import type { Database } from '@hcn/db'
import { IdpAdminError, type IdpAdmin } from '@hcn/domain'
import type { AppConfig } from './config.ts'
import { KeycloakAdmin } from './adapters/keycloak-admin.ts'
import { registerAdminRoutes } from './routes/admin.ts'
import { registerCurriculumRoutes } from './routes/curriculum.ts'
import { registerAuthRoutes } from './routes/auth.ts'
import { registerMeRoutes } from './routes/me.ts'
import { registerOfferingRoutes } from './routes/offerings.ts'
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
  idpAdmin?: IdpAdmin
}

function resolveIdp(config: AppConfig, override?: IdpAdmin): IdpAdmin {
  if (override) return override
  if (!config.keycloakProvisionerSecret) {
    const fail = async (): Promise<never> => {
      throw new IdpAdminError('unavailable')
    }
    return { findByUsername: async () => null, createUser: fail, deleteUser: fail, setEnabled: fail, resetTemporaryPassword: fail }
  }
  return new KeycloakAdmin({
    issuer: config.oidcIssuer,
    clientId: config.keycloakProvisionerClientId ?? 'hcn-provisioner',
    clientSecret: config.keycloakProvisionerSecret,
  })
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
  await app.register(multipart, { limits: { fileSize: 1024 * 1024, files: 1 } })
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
  registerOfferingRoutes(app, options.db)
  registerCurriculumRoutes(app, options.db)
  registerAdminRoutes(app, options.db, resolveIdp(options.config, options.idpAdmin), options.config.oidcIssuer)
  return app
}
