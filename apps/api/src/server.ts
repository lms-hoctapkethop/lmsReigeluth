import cookie from '@fastify/cookie'
import multipart from '@fastify/multipart'
import Fastify, { type FastifyInstance } from 'fastify'
import { sql, type Kysely } from 'kysely'
import type { DestinationStream, Logger } from 'pino'
import type { Database } from '@hcn/db'
import { IdpAdminError, type IdpAdmin } from '@hcn/domain'
import type { AppConfig } from './config.ts'
import { KeycloakAdmin } from './adapters/keycloak-admin.ts'
import { registerAdminRoutes } from './routes/admin.ts'
import { registerAuthoringRoutes } from './routes/authoring.ts'
import { registerLearningRoutes } from './routes/learning.ts'
import { registerQuizRoutes } from './routes/quiz.ts'
import { registerReviewRoutes } from './routes/review.ts'
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
import { recordRequest, statusClass } from './ops/metrics.ts'
import './types.ts'

let oidcCache: { ok: boolean; at: number } | null = null

async function dbReady(db: Kysely<Database>): Promise<'ok' | 'fail'> {
  try {
    const ok = await Promise.race([
      sql`SELECT 1`.execute(db).then(() => true, () => false),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1000)),
    ])
    return ok ? 'ok' : 'fail'
  } catch {
    return 'fail'
  }
}

async function oidcReady(issuer: string): Promise<'ok' | 'fail'> {
  if (oidcCache && Date.now() - oidcCache.at < 60_000) return oidcCache.ok ? 'ok' : 'fail'
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 1000)
  try {
    const response = await fetch(`${issuer}/.well-known/openid-configuration`, { signal: controller.signal })
    oidcCache = { ok: response.ok, at: Date.now() }
    return response.ok ? 'ok' : 'fail'
  } catch {
    return oidcCache?.ok ? 'ok' : 'fail'
  } finally {
    clearTimeout(timer)
  }
}

export type BuildAppOptions = {
  config: AppConfig
  db: Kysely<Database>
  logStream?: DestinationStream
  idpAdmin?: IdpAdmin
  storageDir?: string
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
    bodyLimit: 26 * 1024 * 1024,
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
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024, files: 1 }, throwFileSizeLimit: false })
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
    const route = request.routeOptions.url ?? 'unmatched'
    recordRequest(
      { method: request.method, route, statusClass: statusClass(reply.statusCode) },
      reply.elapsedTime / 1000,
    )
  })
  app.get('/health/live', { config: { public: true } }, async () => ({ status: 'live' }))
  app.get('/health/ready', { config: { public: true } }, async (_request, reply) => {
    const checks = { db: await dbReady(options.db), oidc: await oidcReady(options.config.oidcIssuer) }
    const ready = checks.db === 'ok' && checks.oidc === 'ok'
    return reply.code(ready ? 200 : 503).send({ status: ready ? 'ready' : 'not_ready', checks })
  })
  app.get('/api/v1/runtime', { config: { public: true } }, async () => ({
    env: options.config.hcnEnv ?? 'development',
  }))
  registerAuthRoutes(app, options.db, options.config)
  registerMeRoutes(app, options.db)
  registerOfferingRoutes(app, options.db)
  registerCurriculumRoutes(app, options.db)
  registerAuthoringRoutes(app, options.db)
  registerLearningRoutes(app, options.db, options.storageDir ?? process.env.FILE_STORAGE_DIR ?? '/tmp/hcn-files')
  registerQuizRoutes(app, options.db)
  registerReviewRoutes(app, options.db)
  registerAdminRoutes(app, options.db, resolveIdp(options.config, options.idpAdmin), options.config.oidcIssuer)
  return app
}
