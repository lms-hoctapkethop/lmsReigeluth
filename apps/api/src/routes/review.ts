import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Kysely } from 'kysely'
import type { Database } from '@hcn/db'
import {
  DomainError,
  cancelFamilySupport,
  commitFamilySupport,
  getLearnerRecords,
  getReviewQueue,
  listNotifications,
  markNotificationRead,
  openReview,
  publishReview,
  saveReviewDraft,
  supersedeDecision,
  systemClock,
  type Actor,
} from '@hcn/domain'
import { writeRateLimit } from '../plugins/rate-limit.ts'

const uuid = z.string().uuid()
const level = z.enum(['meets', 'developing', 'not_yet', 'not_shown'])

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

function requireKey(request: FastifyRequest): string {
  const key = header(request, 'idempotency-key')
  if (!key) throw new DomainError('VALIDATION_FAILED', { reason: 'IDEMPOTENCY_KEY' })
  return key
}

export function registerReviewRoutes(app: FastifyInstance, db: Kysely<Database>): void {
  app.get('/api/v1/offerings/:offeringId/review-queue', async (request) => {
    const params = z.strictObject({ offeringId: uuid }).parse(request.params)
    const query = z
      .strictObject({
        status: z.enum(['submitted', 'changes_requested', 'reviewed']).optional(),
        late: z.enum(['true', 'false']).optional(),
        itemId: uuid.optional(),
        cursor: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
      })
      .parse(request.query)
    return getReviewQueue(db, meta(request), params.offeringId, {
      limit: query.limit ?? 50,
      ...(query.status ? { status: query.status } : {}),
      ...(query.late ? { late: query.late === 'true' } : {}),
      ...(query.itemId ? { itemId: query.itemId } : {}),
      ...(query.cursor ? { cursor: query.cursor } : {}),
    })
  })

  app.post('/api/v1/submission-versions/:submissionVersionId/reviews', { config: { rateLimit: writeRateLimit } }, async (request) => {
    const params = z.strictObject({ submissionVersionId: uuid }).parse(request.params)
    return openReview(db, meta(request), params.submissionVersionId)
  })

  app.put('/api/v1/reviews/:reviewId', { config: { rateLimit: writeRateLimit } }, async (request) => {
    const params = z.strictObject({ reviewId: uuid }).parse(request.params)
    const body = z
      .strictObject({
        comment: z.string().max(5000).nullable(),
        criteria: z.array(z.strictObject({ criterionId: uuid, level: level.nullable(), note: z.string().max(2000).nullable(), title: z.string().optional() })),
      })
      .parse(request.body)
    return saveReviewDraft(db, meta(request), params.reviewId, header(request, 'if-match'), {
      comment: body.comment,
      criteria: body.criteria.map((row) => ({ criterionId: row.criterionId, level: row.level, note: row.note })),
    })
  })

  app.post('/api/v1/reviews/:reviewId/publish', { config: { rateLimit: writeRateLimit } }, async (request) => {
    const params = z.strictObject({ reviewId: uuid }).parse(request.params)
    const body = z
      .strictObject({
        expectedRevision: z.number().int(),
        expectedSubmissionVersionId: uuid,
        outcome: z.enum(['reviewed', 'changes_requested']),
        decisions: z.array(
          z.strictObject({
            requirementId: uuid,
            decision: z.enum(['achieved', 'not_yet']),
            reason: z.string().min(3),
          }),
        ),
      })
      .parse(request.body)
    return publishReview(db, meta(request), params.reviewId, { ...body, idempotencyKey: requireKey(request) })
  })

  app.post('/api/v1/attainment-decisions/:decisionId/supersede', { config: { rateLimit: writeRateLimit } }, async (request, reply) => {
    const params = z.strictObject({ decisionId: uuid }).parse(request.params)
    const body = z
      .strictObject({
        decision: z.enum(['achieved', 'not_yet']),
        reason: z.string().min(5),
        reviewId: uuid,
      })
      .parse(request.body)
    const created = await supersedeDecision(db, meta(request), params.decisionId, { ...body, idempotencyKey: requireKey(request) })
    return reply.code(201).send(created)
  })

  app.get('/api/v1/learners/:learnerId/records', async (request) => {
    const params = z.strictObject({ learnerId: uuid }).parse(request.params)
    const query = z.strictObject({ offeringId: uuid }).parse(request.query)
    return getLearnerRecords(db, meta(request), params.learnerId, query.offeringId)
  })

  app.post('/api/v1/family-supports', { config: { rateLimit: writeRateLimit } }, async (request, reply) => {
    const body = z
      .strictObject({
        learnerId: uuid,
        offeringId: uuid.optional(),
        content: z.string().min(3).max(500),
      })
      .parse(request.body)
    const created = await commitFamilySupport(db, meta(request), {
      learnerId: body.learnerId,
      content: body.content,
      idempotencyKey: requireKey(request),
      ...(body.offeringId ? { offeringId: body.offeringId } : {}),
    })
    return reply.code(201).send(created)
  })

  app.post('/api/v1/family-supports/:supportId/cancel', { config: { rateLimit: writeRateLimit } }, async (request) => {
    const params = z.strictObject({ supportId: uuid }).parse(request.params)
    return cancelFamilySupport(db, meta(request), params.supportId)
  })

  app.get('/api/v1/notifications', async (request) => {
    const query = z.strictObject({ unread: z.enum(['true', 'false']).optional() }).parse(request.query)
    return listNotifications(db, meta(request), query.unread === 'true')
  })

  app.post('/api/v1/notifications/:notificationId/read', { config: { rateLimit: writeRateLimit } }, async (request, reply) => {
    const params = z.strictObject({ notificationId: uuid }).parse(request.params)
    await markNotificationRead(db, meta(request), params.notificationId)
    return reply.code(204).send()
  })
}
