import { createReadStream } from 'node:fs'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Kysely } from 'kysely'
import { submissionBodyInput, submitAssignmentInput } from '@hcn/contracts'
import type { Database } from '@hcn/db'
import {
  changeSchedule,
  dispositionHeader,
  DomainError,
  getLearnerToday,
  getReleaseForLearner,
  getSubmission,
  getSubmissionDraft,
  listModuleVersions,
  listReleases,
  markViewed,
  openDownload,
  readFileMeta,
  releaseModules,
  saveSubmissionDraft,
  selfMark,
  submitAssignment,
  systemClock,
  uploadFile,
  type Actor,
} from '@hcn/domain'
import { uploadRateLimit, writeRateLimit } from '../plugins/rate-limit.ts'

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

export function registerLearningRoutes(app: FastifyInstance, db: Kysely<Database>, storageDir: string): void {
  app.post('/api/v1/offerings/:offeringId/path-releases', { config: { rateLimit: writeRateLimit } }, async (request, reply) => {
    const params = z.strictObject({ offeringId: uuid }).parse(request.params)
    const body = z.strictObject({
      title: z.string().min(1).max(200),
      modules: z.array(z.strictObject({
        moduleVersionId: uuid,
        availableFrom: z.string().min(1),
        dueAt: z.string().nullable().optional(),
        acceptUntil: z.string().nullable().optional(),
        latePolicy: z.enum(['reject', 'accept_marked']).optional(),
      })).min(1).max(20),
    }).parse(request.body)
    const key = header(request, 'idempotency-key')
    if (!key) throw new DomainError('VALIDATION_FAILED', { reason: 'IDEMPOTENCY_KEY' })
    const modules = body.modules.map((item) => ({
      moduleVersionId: item.moduleVersionId,
      availableFrom: item.availableFrom,
      ...(item.dueAt !== undefined ? { dueAt: item.dueAt } : {}),
      ...(item.acceptUntil !== undefined ? { acceptUntil: item.acceptUntil } : {}),
      ...(item.latePolicy !== undefined ? { latePolicy: item.latePolicy } : {}),
    }))
    const receipt = await releaseModules(db, meta(request), params.offeringId, { title: body.title, modules, idempotencyKey: key })
    return reply.code(201).send(receipt)
  })

  app.get('/api/v1/offerings/:offeringId/releases', async (request) => {
    const params = z.strictObject({ offeringId: uuid }).parse(request.params)
    return listReleases(db, meta(request), params.offeringId)
  })

  app.patch('/api/v1/module-releases/:releaseId/schedule', { config: { rateLimit: writeRateLimit } }, async (request) => {
    const params = z.strictObject({ releaseId: uuid }).parse(request.params)
    const body = z.strictObject({
      dueAt: z.string().nullable().optional(),
      acceptUntil: z.string().nullable().optional(),
      reason: z.string().min(3).max(2000),
    }).parse(request.body)
    return changeSchedule(db, meta(request), params.releaseId, {
      reason: body.reason,
      ifMatch: header(request, 'if-match'),
      ...(body.dueAt !== undefined ? { dueAt: body.dueAt } : {}),
      ...(body.acceptUntil !== undefined ? { acceptUntil: body.acceptUntil } : {}),
    })
  })

  app.get('/api/v1/modules/:moduleId/versions', async (request) => {
    const params = z.strictObject({ moduleId: uuid }).parse(request.params)
    return listModuleVersions(db, meta(request), params.moduleId)
  })

  app.get('/api/v1/me/today', async (request) => getLearnerToday(db, meta(request)))

  app.get('/api/v1/module-releases/:releaseId', async (request) => {
    const params = z.strictObject({ releaseId: uuid }).parse(request.params)
    return getReleaseForLearner(db, meta(request), params.releaseId)
  })

  app.post('/api/v1/module-releases/:releaseId/items/:itemId/view', { config: { rateLimit: writeRateLimit } }, async (request) => {
    const params = z.strictObject({ releaseId: uuid, itemId: uuid }).parse(request.params)
    return markViewed(db, meta(request), params.releaseId, params.itemId)
  })

  app.post('/api/v1/module-releases/:releaseId/items/:itemId/self-mark', { config: { rateLimit: writeRateLimit } }, async (request) => {
    const params = z.strictObject({ releaseId: uuid, itemId: uuid }).parse(request.params)
    return selfMark(db, meta(request), params.releaseId, params.itemId)
  })

  app.get('/api/v1/module-releases/:releaseId/items/:itemId/submission/draft', async (request) => {
    const params = z.strictObject({ releaseId: uuid, itemId: uuid }).parse(request.params)
    return getSubmissionDraft(db, meta(request), params.releaseId, params.itemId)
  })

  app.put('/api/v1/module-releases/:releaseId/items/:itemId/submission/draft', { config: { rateLimit: writeRateLimit } }, async (request, reply) => {
    const params = z.strictObject({ releaseId: uuid, itemId: uuid }).parse(request.params)
    submissionBodyInput.parse(request.body)
    const draft = await saveSubmissionDraft(db, meta(request), params.releaseId, params.itemId, header(request, 'if-match'), request.body)
    reply.header('etag', `W/"${String(draft.draftRevision)}"`)
    return draft
  })

  app.post('/api/v1/module-releases/:releaseId/items/:itemId/submissions', { config: { rateLimit: writeRateLimit } }, async (request, reply) => {
    const params = z.strictObject({ releaseId: uuid, itemId: uuid }).parse(request.params)
    const body = submitAssignmentInput.parse(request.body)
    const key = header(request, 'idempotency-key')
    if (!key) throw new DomainError('VALIDATION_FAILED', { reason: 'IDEMPOTENCY_KEY' })
    const receipt = await submitAssignment(db, meta(request), params.releaseId, params.itemId, { draftRevision: body.draftRevision, idempotencyKey: key })
    return reply.code(201).send(receipt)
  })

  app.get('/api/v1/submissions/:submissionId', async (request) => {
    const params = z.strictObject({ submissionId: uuid }).parse(request.params)
    return getSubmission(db, meta(request), params.submissionId)
  })

  app.post('/api/v1/files', { config: { rateLimit: uploadRateLimit } }, async (request, reply) => {
    const part = await request.file()
    if (!part) throw new DomainError('VALIDATION_FAILED', { reason: 'FILE' })
    const uploaded = await uploadFile(db, meta(request), {
      stream: part.file,
      originalName: part.filename,
      storageDir,
      truncated: () => part.file.truncated,
    })
    return reply.code(201).send(uploaded)
  })

  app.get('/api/v1/files/:fileId/meta', async (request) => {
    const params = z.strictObject({ fileId: uuid }).parse(request.params)
    return readFileMeta(db, meta(request), params.fileId)
  })

  app.get('/api/v1/files/:fileId', async (request, reply) => {
    const params = z.strictObject({ fileId: uuid }).parse(request.params)
    const query = z.strictObject({ disposition: z.enum(['inline', 'attachment']).optional() }).parse(request.query)
    const opened = await openDownload(db, meta(request), params.fileId, storageDir, query.disposition === 'inline')
    reply.header('Content-Disposition', dispositionHeader(opened.meta.originalName, opened.inline))
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('Content-Security-Policy', 'sandbox')
    reply.type(opened.meta.mime)
    return reply.send(createReadStream(opened.path))
  })
}
