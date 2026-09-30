import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Kysely } from 'kysely'
import type { Database } from '@hcn/db'
import {
  curriculumAccess,
  DomainError,
  getCurriculumReviewQueue,
  getKcVersionDetail,
  listKcEdges,
  listMisconceptions,
  listRequirements,
  proposeKc,
  proposeKcEdge,
  proposeKcVersion,
  proposeMisconception,
  reviewKcEdge,
  reviewKcVersion,
  reviewMisconception,
  reviewRequirement,
  reviewRequirementKcLink,
  systemClock,
  type Actor,
  type QueueKind,
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

function ifMatch(request: FastifyRequest): string | undefined {
  const value = request.headers['if-match']
  return Array.isArray(value) ? value[0] : value
}

export function registerCurriculumRoutes(app: FastifyInstance, db: Kysely<Database>): void {
  app.get('/api/v1/curriculum/access', async (request) => curriculumAccess(db, meta(request)))

  app.get('/api/v1/curriculum/requirements', async (request) => {
    const query = z.strictObject({ subject: z.string(), grade: z.coerce.number().int(), q: z.string().optional() }).parse(request.query)
    return listRequirements(db, meta(request), { subject: query.subject, grade: query.grade, ...(query.q ? { q: query.q } : {}) })
  })

  app.post('/api/v1/curriculum/requirements/:requirementId/review', async (request) => {
    const params = z.strictObject({ requirementId: uuid }).parse(request.params)
    const body = z.strictObject({
      decision: z.enum(['source_checked', 'approved', 'rejected']),
      note: z.string().optional(),
      correctedText: z.string().optional(),
    }).parse(request.body)
    return reviewRequirement(db, meta(request), params.requirementId, {
      decision: body.decision,
      ifMatch: ifMatch(request),
      ...(body.note !== undefined ? { note: body.note } : {}),
      ...(body.correctedText !== undefined ? { correctedText: body.correctedText } : {}),
    })
  })

  app.get('/api/v1/curriculum/review-queue', async (request) => {
    const query = z.strictObject({
      kind: z.enum(['requirement', 'kc', 'edge', 'misconception', 'link']).optional(),
      cursor: z.string().optional(),
      limit: z.coerce.number().int().optional(),
    }).parse(request.query)
    return getCurriculumReviewQueue(db, meta(request), {
      ...(query.kind ? { kind: query.kind as QueueKind } : {}),
      ...(query.cursor ? { cursor: query.cursor } : {}),
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
    })
  })

  app.post('/api/v1/curriculum/kcs', async (request, reply) => {
    const body = z.strictObject({
      code: z.string(),
      subjectCode: z.string(),
      grade: z.number().int(),
      name: z.string(),
      description: z.string().optional(),
      observableCriteria: z.string(),
      requirementIds: z.array(uuid),
    }).parse(request.body)
    const created = await proposeKc(db, meta(request), {
      code: body.code,
      subjectCode: body.subjectCode,
      grade: body.grade,
      name: body.name,
      observableCriteria: body.observableCriteria,
      requirementIds: body.requirementIds,
      ...(body.description !== undefined ? { description: body.description } : {}),
    })
    return reply.code(201).send(created)
  })

  app.post('/api/v1/curriculum/kcs/:kcId/versions', async (request, reply) => {
    const params = z.strictObject({ kcId: uuid }).parse(request.params)
    const body = z.strictObject({ name: z.string(), description: z.string().optional(), observableCriteria: z.string() }).parse(request.body)
    const created = await proposeKcVersion(db, meta(request), {
      kcId: params.kcId,
      name: body.name,
      observableCriteria: body.observableCriteria,
      ...(body.description !== undefined ? { description: body.description } : {}),
    })
    return reply.code(201).send(created)
  })

  app.get('/api/v1/curriculum/kc-versions/:kcVersionId', async (request) => {
    const params = z.strictObject({ kcVersionId: uuid }).parse(request.params)
    return getKcVersionDetail(db, meta(request), params.kcVersionId)
  })

  app.post('/api/v1/curriculum/kc-versions/:kcVersionId/review', async (request) => {
    const params = z.strictObject({ kcVersionId: uuid }).parse(request.params)
    const body = z.strictObject({
      decision: z.enum(['approved', 'rejected']),
      note: z.string().optional(),
      dropEdgeIds: z.array(uuid).optional(),
      dropLinkIds: z.array(uuid).optional(),
    }).parse(request.body)
    return reviewKcVersion(db, meta(request), params.kcVersionId, {
      decision: body.decision,
      ...(body.note !== undefined ? { note: body.note } : {}),
      ...(body.dropEdgeIds ? { dropEdgeIds: body.dropEdgeIds } : {}),
      ...(body.dropLinkIds ? { dropLinkIds: body.dropLinkIds } : {}),
    })
  })

  app.get('/api/v1/curriculum/kc-edges', async (request) => {
    const query = z.strictObject({
      scope: z.enum(['effective', 'proposed']).optional(),
      kcVersionId: uuid.optional(),
    }).parse(request.query)
    return listKcEdges(db, meta(request), {
      ...(query.scope ? { scope: query.scope } : {}),
      ...(query.kcVersionId ? { kcVersionId: query.kcVersionId } : {}),
    })
  })

  app.post('/api/v1/curriculum/kc-edges', async (request, reply) => {
    const body = z.strictObject({
      fromKcVersionId: uuid,
      toKcVersionId: uuid,
      edgeType: z.enum(['prerequisite', 'develops_into', 'part_of']),
      rationale: z.string().optional(),
    }).parse(request.body)
    const created = await proposeKcEdge(db, meta(request), {
      fromKcVersionId: body.fromKcVersionId,
      toKcVersionId: body.toKcVersionId,
      edgeType: body.edgeType,
      ...(body.rationale !== undefined ? { rationale: body.rationale } : {}),
    })
    return reply.code(201).send(created)
  })

  app.post('/api/v1/curriculum/kc-edges/:edgeId/review', async (request) => {
    const params = z.strictObject({ edgeId: uuid }).parse(request.params)
    const body = z.strictObject({ decision: z.enum(['approved', 'rejected']) }).parse(request.body)
    return reviewKcEdge(db, meta(request), params.edgeId, body)
  })

  app.post('/api/v1/curriculum/requirement-kc-links/:linkId/review', async (request) => {
    const params = z.strictObject({ linkId: uuid }).parse(request.params)
    const body = z.strictObject({ decision: z.enum(['approved', 'rejected']) }).parse(request.body)
    return reviewRequirementKcLink(db, meta(request), params.linkId, body)
  })

  app.get('/api/v1/curriculum/misconceptions', async (request) => {
    const query = z.strictObject({ kcId: uuid.optional(), status: z.string().optional() }).parse(request.query)
    return listMisconceptions(db, meta(request), {
      ...(query.kcId ? { kcId: query.kcId } : {}),
      ...(query.status ? { status: query.status } : {}),
    })
  })

  app.post('/api/v1/curriculum/misconceptions', async (request, reply) => {
    const body = z.strictObject({ code: z.string(), kcId: uuid, description: z.string() }).parse(request.body)
    const created = await proposeMisconception(db, meta(request), body)
    return reply.code(201).send(created)
  })

  app.post('/api/v1/curriculum/misconceptions/:misconceptionId/review', async (request) => {
    const params = z.strictObject({ misconceptionId: uuid }).parse(request.params)
    const body = z.strictObject({ decision: z.enum(['approved', 'rejected']) }).parse(request.body)
    return reviewMisconception(db, meta(request), params.misconceptionId, body)
  })
}
