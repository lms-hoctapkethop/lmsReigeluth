import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Kysely } from 'kysely'
import type { Database } from '@hcn/db'
import { writeRateLimit } from '../plugins/rate-limit.ts'
import {
  authoringCatalog,
  createModule,
  DomainError,
  getModuleDraft,
  listAuthorCourses,
  listMyModules,
  previewModuleDraftAsLearner,
  publishModuleVersion,
  saveModuleDraft,
  systemClock,
  validateModuleDraft,
  type Actor,
} from '@hcn/domain'

const uuid = z.string().uuid()

function meta(request: FastifyRequest): { actor: Actor; requestId: string; clock: typeof systemClock } {
  if (!request.auth) throw new DomainError('UNAUTHENTICATED')
  return {
    actor: { userId: request.auth.userId, schoolId: request.auth.schoolId, roles: [request.auth.role] },
    requestId: request.id,
    clock: systemClock,
  }
}

function header(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name]
  return Array.isArray(value) ? value[0] : value
}

export function registerAuthoringRoutes(app: FastifyInstance, db: Kysely<Database>): void {
  app.get('/api/v1/authoring/courses', async (request) => listAuthorCourses(db, meta(request)))

  app.get('/api/v1/authoring/catalog', async (request) => {
    const query = z.strictObject({ courseId: uuid }).parse(request.query)
    return authoringCatalog(db, meta(request), query.courseId)
  })

  app.get('/api/v1/modules', async (request) => {
    const query = z.strictObject({ courseId: uuid }).parse(request.query)
    return listMyModules(db, meta(request), query.courseId)
  })

  app.post('/api/v1/modules', { config: { rateLimit: writeRateLimit } }, async (request, reply) => {
    const body = z.strictObject({
      courseId: uuid,
      title: z.string().min(1).max(200),
      requirementIds: z.array(uuid).max(30).optional(),
    }).parse(request.body)
    const envelope = await createModule(db, meta(request), {
      courseId: body.courseId,
      title: body.title,
      requirementIds: body.requirementIds ?? [],
    })
    return reply.code(201).send(envelope)
  })

  app.get('/api/v1/modules/:moduleId/draft', async (request, reply) => {
    const params = z.strictObject({ moduleId: uuid }).parse(request.params)
    const envelope = await getModuleDraft(db, meta(request), params.moduleId)
    reply.header('etag', `W/"${envelope.revision}"`)
    return envelope
  })

  app.put('/api/v1/modules/:moduleId/draft', { config: { rateLimit: writeRateLimit } }, async (request) => {
    const params = z.strictObject({ moduleId: uuid }).parse(request.params)
    return saveModuleDraft(db, meta(request), params.moduleId, header(request, 'if-match'), request.body)
  })

  app.post('/api/v1/modules/:moduleId/draft/validate', { config: { rateLimit: writeRateLimit } }, async (request) => {
    const params = z.strictObject({ moduleId: uuid }).parse(request.params)
    return validateModuleDraft(db, meta(request), params.moduleId)
  })

  app.get('/api/v1/modules/:moduleId/draft/preview', async (request) => {
    const params = z.strictObject({ moduleId: uuid }).parse(request.params)
    return previewModuleDraftAsLearner(db, meta(request), params.moduleId)
  })

  app.post('/api/v1/modules/:moduleId/versions', { config: { rateLimit: writeRateLimit } }, async (request, reply) => {
    const params = z.strictObject({ moduleId: uuid }).parse(request.params)
    const body = z.strictObject({
      expectedRevision: z.number().int().min(1),
      acknowledgements: z.array(z.strictObject({
        code: z.string().min(1),
        target: z.string().min(1),
        reason: z.string().min(5),
      })).optional(),
    }).parse(request.body)
    const key = header(request, 'idempotency-key')
    if (!key) throw new DomainError('VALIDATION_FAILED', { reason: 'IDEMPOTENCY_KEY' })
    const summary = await publishModuleVersion(db, meta(request), params.moduleId, {
      expectedRevision: body.expectedRevision,
      acknowledgements: body.acknowledgements ?? [],
      idempotencyKey: key,
    })
    return reply.code(201).send(summary)
  })
}
