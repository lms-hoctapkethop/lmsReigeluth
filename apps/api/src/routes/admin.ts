import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Kysely } from 'kysely'
import type { Database } from '@hcn/db'
import {
  assignTeacher,
  createAcademicYear,
  createAdminClass,
  createCourse,
  createGuardianLink,
  createOffering,
  DomainError,
  endTeacherAssignment,
  enrollLearners,
  getAdminOffering,
  importUsers,
  listAcademicYears,
  listAdminClasses,
  listClassLearners,
  listCourses,
  listGuardianLinks,
  listSchoolUsers,
  lockUser,
  resetTemporaryPassword,
  revokeGuardianLink,
  systemClock,
  transferClass,
  unlockUser,
  verifyGuardianLink,
  withdrawEnrollment,
  type Actor,
  type IdpAdmin,
} from '@hcn/domain'
import { importRateLimit, writeRateLimit } from '../plugins/rate-limit.ts'

const uuid = z.string().uuid()
const yearBody = z.strictObject({ code: z.string(), startsOn: z.string(), endsOn: z.string() })
const classBody = z.strictObject({ academicYearId: uuid, grade: z.number().int(), code: z.string() })
const courseBody = z.strictObject({ subjectCode: z.string(), grade: z.number().int(), title: z.string() })
const offeringBody = z.strictObject({
  courseId: uuid,
  academicYearId: uuid,
  term: z.union([z.literal(1), z.literal(2)]),
  code: z.string(),
  title: z.string(),
  classIds: z.array(uuid).optional(),
})
const assignBody = z.strictObject({
  teacherId: uuid,
  capabilities: z.array(z.enum(['teach', 'author', 'release', 'review', 'view'])).optional(),
})
const enrollBody = z.strictObject({ learnerIds: z.array(uuid).min(1).max(500) })
const withdrawBody = z.strictObject({ learnerId: uuid })
const linkBody = z.strictObject({
  guardianId: uuid,
  learnerId: uuid,
  relation: z.enum(['father', 'mother', 'guardian', 'other']),
})
const reasonBody = z.strictObject({ reason: z.string().min(3) })
const transferBody = z.strictObject({ learnerId: uuid, toClassId: uuid, onDate: z.string() })

function meta(request: FastifyRequest): { actor: Actor; requestId: string; clock: typeof systemClock } {
  if (!request.auth) throw new DomainError('UNAUTHENTICATED')
  return {
    actor: { userId: request.auth.userId, schoolId: request.auth.schoolId, roles: [request.auth.role] },
    requestId: request.id,
    clock: systemClock,
  }
}

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body)
  if (!parsed.success) throw parsed.error
  return parsed.data
}

export function registerAdminRoutes(app: FastifyInstance, db: Kysely<Database>, idp: IdpAdmin, issuer: string): void {
  app.get('/api/v1/admin/academic-years', async (request) => listAcademicYears(db, meta(request)))
  app.post('/api/v1/admin/academic-years', { config: { rateLimit: writeRateLimit } }, async (request, reply) => {
    const body = parse(yearBody, request.body)
    const created = await createAcademicYear(db, meta(request), body)
    return reply.status(201).send(created)
  })

  app.get('/api/v1/admin/classes', async (request) => listAdminClasses(db, meta(request)))
  app.post('/api/v1/admin/classes', { config: { rateLimit: writeRateLimit } }, async (request, reply) => {
    const created = await createAdminClass(db, meta(request), parse(classBody, request.body))
    return reply.status(201).send(created)
  })
  app.get<{ Params: { classId: string } }>('/api/v1/admin/classes/:classId/learners', async (request) =>
    listClassLearners(db, meta(request), request.params.classId),
  )

  app.get('/api/v1/admin/courses', async (request) => listCourses(db, meta(request)))
  app.post('/api/v1/admin/courses', { config: { rateLimit: writeRateLimit } }, async (request, reply) => {
    const created = await createCourse(db, meta(request), parse(courseBody, request.body))
    return reply.status(201).send(created)
  })

  app.post('/api/v1/admin/offerings', { config: { rateLimit: writeRateLimit } }, async (request, reply) => {
    const body = parse(offeringBody, request.body)
    const created = await createOffering(db, meta(request), {
      courseId: body.courseId,
      academicYearId: body.academicYearId,
      term: body.term,
      code: body.code,
      title: body.title,
      ...(body.classIds ? { classIds: body.classIds } : {}),
    })
    return reply.status(201).send(created)
  })
  app.get<{ Params: { offeringId: string } }>('/api/v1/admin/offerings/:offeringId', async (request) =>
    getAdminOffering(db, meta(request), request.params.offeringId),
  )
  app.post<{ Params: { offeringId: string } }>(
    '/api/v1/admin/offerings/:offeringId/teachers',
    { config: { rateLimit: writeRateLimit } },
    async (request, reply) => {
      const body = parse(assignBody, request.body)
      const created = await assignTeacher(db, meta(request), {
        offeringId: request.params.offeringId,
        teacherId: body.teacherId,
        ...(body.capabilities ? { capabilities: body.capabilities } : {}),
      })
      return reply.status(201).send(created)
    },
  )
  app.post<{ Params: { offeringId: string; assignmentId: string } }>(
    '/api/v1/admin/offerings/:offeringId/assignments/:assignmentId/end',
    { config: { rateLimit: writeRateLimit } },
    async (request) => endTeacherAssignment(db, meta(request), request.params),
  )
  app.post<{ Params: { offeringId: string } }>(
    '/api/v1/admin/offerings/:offeringId/enrollments',
    { config: { rateLimit: writeRateLimit } },
    async (request) => enrollLearners(db, meta(request), { offeringId: request.params.offeringId, ...parse(enrollBody, request.body) }),
  )
  app.post<{ Params: { offeringId: string } }>(
    '/api/v1/admin/offerings/:offeringId/enrollments/withdraw',
    { config: { rateLimit: writeRateLimit } },
    async (request) =>
      withdrawEnrollment(db, meta(request), { offeringId: request.params.offeringId, ...parse(withdrawBody, request.body) }),
  )

  app.get('/api/v1/admin/users', async (request) => {
    const query = request.query as { q?: string; role?: string; classId?: string; cursor?: string }
    return listSchoolUsers(db, meta(request), query)
  })
  app.post<{ Params: { userId: string } }>('/api/v1/admin/users/:userId/lock', { config: { rateLimit: writeRateLimit } }, async (request) =>
    lockUser(db, meta(request), idp, { userId: request.params.userId, ...parse(reasonBody, request.body) }),
  )
  app.post<{ Params: { userId: string } }>('/api/v1/admin/users/:userId/unlock', { config: { rateLimit: writeRateLimit } }, async (request) =>
    unlockUser(db, meta(request), idp, { userId: request.params.userId, ...parse(reasonBody, request.body) }),
  )
  app.post<{ Params: { userId: string } }>(
    '/api/v1/admin/users/:userId/reset-password',
    { config: { rateLimit: writeRateLimit } },
    async (request, reply) => {
      reply.header('cache-control', 'no-store')
      return resetTemporaryPassword(db, meta(request), idp, request.params.userId)
    },
  )
  app.post('/api/v1/admin/users/import', { config: { rateLimit: importRateLimit } }, async (request, reply) => {
    const keyHeader = request.headers['idempotency-key']
    const idempotencyKey = Array.isArray(keyHeader) ? keyHeader[0] : keyHeader
    if (!idempotencyKey) throw new DomainError('BAD_REQUEST')
    const file = await request.file()
    if (!file) throw new DomainError('VALIDATION_FAILED')
    const buffer = await file.toBuffer()
    if (buffer.length > 1024 * 1024) throw new DomainError('FILE_TOO_LARGE')
    const lineCount = buffer.toString('utf8').split(/\r?\n/).filter((line) => line.trim().length > 0).length
    if (lineCount > 2001) throw new DomainError('VALIDATION_FAILED', { reason: 'TOO_MANY_ROWS' })
    reply.header('cache-control', 'no-store')
    return importUsers(db, meta(request), idp, { csv: buffer.toString('utf8'), idempotencyKey, issuer })
  })

  app.post('/api/v1/admin/classes/transfer', { config: { rateLimit: writeRateLimit } }, async (request) =>
    transferClass(db, meta(request), parse(transferBody, request.body)),
  )

  app.get('/api/v1/admin/guardian-links', async (request) => {
    const status = (request.query as { status?: 'pending' | 'verified' | 'revoked' }).status
    return listGuardianLinks(db, meta(request), status)
  })
  app.post('/api/v1/admin/guardian-links', { config: { rateLimit: writeRateLimit } }, async (request, reply) => {
    const created = await createGuardianLink(db, meta(request), parse(linkBody, request.body))
    return reply.status(201).send(created)
  })
  app.post<{ Params: { linkId: string } }>(
    '/api/v1/admin/guardian-links/:linkId/verify',
    { config: { rateLimit: writeRateLimit } },
    async (request) => verifyGuardianLink(db, meta(request), request.params.linkId),
  )
  app.post<{ Params: { linkId: string } }>(
    '/api/v1/admin/guardian-links/:linkId/revoke',
    { config: { rateLimit: writeRateLimit } },
    async (request) => revokeGuardianLink(db, meta(request), { linkId: request.params.linkId, ...parse(reasonBody, request.body) }),
  )
}
