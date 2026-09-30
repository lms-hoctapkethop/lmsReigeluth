import type { FastifyInstance } from 'fastify'
import { ZodError } from 'zod'
import { DomainError } from '@hcn/domain'

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    const requestId = request.id
    if (error instanceof DomainError) {
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          request_id: requestId,
          ...(error.details ? { details: error.details } : {}),
        },
      })
    }
    if (error instanceof ZodError) {
      const paths = error.issues.map((issue) => issue.path.map(String).join('.')).filter((path) => path.length > 0)
      return reply.status(422).send({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Dữ liệu không hợp lệ.',
          request_id: requestId,
          details: { path: paths[0] ?? '', paths },
        },
      })
    }
    const statusCode = typeof error === 'object' && error && 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500
    if (statusCode === 400) {
      return reply.status(400).send({
        error: { code: 'BAD_REQUEST', message: 'Yêu cầu không đọc được.', request_id: requestId },
      })
    }
    if (statusCode === 429) {
      return reply.status(429).send({
        error: { code: 'RATE_LIMITED', message: 'Bạn thao tác quá nhanh. Hãy thử lại sau.', request_id: requestId },
      })
    }
    request.log.error({ request_id: requestId, error_code: 'INTERNAL' }, 'request failed')
    return reply.status(500).send({
      error: { code: 'INTERNAL', message: 'Đã có lỗi. Hãy thử lại.', request_id: requestId },
    })
  })
}
