import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Kysely } from 'kysely'
import type { Database } from '@hcn/db'
import { answerQuestion, DomainError, getAttempt, requestHint, startAttempt, submitAttempt, systemClock, type Actor } from '@hcn/domain'
import { answerRateLimit, hintRateLimit } from '../plugins/rate-limit.ts'

const uuid = z.string().uuid()
const disabled = new Set(['minScore', 'min_score', 'kcGate', 'kc_gate', 'gate'])
const attainment = new Set(['decision', 'attainment', 'attainmentDecision'])

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

function screenBody(body: unknown): void {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return
  const keys = Object.keys(body)
  if (keys.some((key) => disabled.has(key))) throw new DomainError('FEATURE_NOT_ENABLED', { reason: 'MIN_SCORE_OR_KC_GATE' })
  if (keys.some((key) => attainment.has(key))) throw new DomainError('VALIDATION_FAILED', { reason: 'ATTAINMENT' })
}

const responseBody = z.union([
  z.strictObject({ option: z.string().min(1).max(8) }),
  z.strictObject({ options: z.array(z.string().min(1).max(8)).min(1).max(8) }),
  z.strictObject({ raw: z.string().max(200) }),
  z.strictObject({ notLearned: z.literal(true) }),
])

function privateNoStore(reply: { header: (name: string, value: string) => void }): void {
  reply.header('cache-control', 'private, no-store')
}

export function registerQuizRoutes(app: FastifyInstance, db: Kysely<Database>): void {
  app.post('/api/v1/module-releases/:releaseId/items/:itemId/attempts', async (request, reply) => {
    privateNoStore(reply)
    screenBody(request.body)
    const params = z.strictObject({ releaseId: uuid, itemId: uuid }).parse(request.params)
    const attempt = await startAttempt(db, meta(request), params.releaseId, params.itemId, requireKey(request))
    return reply.code(201).send(attempt)
  })

  app.get('/api/v1/attempts/:attemptId', async (request, reply) => {
    privateNoStore(reply)
    const params = z.strictObject({ attemptId: uuid }).parse(request.params)
    return reply.send(await getAttempt(db, meta(request), params.attemptId))
  })

  app.post('/api/v1/attempts/:attemptId/questions/:questionId/answers', { config: { rateLimit: answerRateLimit } }, async (request, reply) => {
    privateNoStore(reply)
    screenBody(request.body)
    const params = z.strictObject({ attemptId: uuid, questionId: uuid }).parse(request.params)
    const body = z.strictObject({ response: responseBody }).parse(request.body)
    const parsed = body.response
    const response = 'notLearned' in parsed
      ? { notLearned: true as const }
      : 'option' in parsed
        ? { option: parsed.option }
        : 'options' in parsed
          ? { options: parsed.options }
          : { raw: parsed.raw }
    return reply.send(await answerQuestion(db, meta(request), params.attemptId, params.questionId, {
      response,
      idempotencyKey: requireKey(request),
    }))
  })

  app.post('/api/v1/attempts/:attemptId/questions/:questionId/hints', { config: { rateLimit: hintRateLimit } }, async (request, reply) => {
    privateNoStore(reply)
    screenBody(request.body)
    const params = z.strictObject({ attemptId: uuid, questionId: uuid }).parse(request.params)
    return reply.send(await requestHint(db, meta(request), params.attemptId, params.questionId))
  })

  app.post('/api/v1/attempts/:attemptId/submit', async (request, reply) => {
    privateNoStore(reply)
    screenBody(request.body)
    z.strictObject({}).parse(request.body ?? {})
    const params = z.strictObject({ attemptId: uuid }).parse(request.params)
    return reply.send(await submitAttempt(db, meta(request), params.attemptId, requireKey(request)))
  })
}
