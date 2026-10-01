import rateLimit from '@fastify/rate-limit'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { DomainError } from '@hcn/domain'

/**
 * 20 request/phút/IP trên production (docs/04). Mỗi route có store riêng,
 * nên 20 lần GET /auth/login là đủ một lớp học đăng nhập cùng lúc.
 * Bộ hành trình E2E đăng nhập hơn 20 lần trong một phút từ một IP khi máy chạy nhanh,
 * và trang 429 không có #username nên Playwright chờ đến hết timeout của cả test.
 * HCN_TEST_CLOCK chỉ bật ở Playwright, không bật ở production.
 */
const authMax = process.env.HCN_TEST_CLOCK === '1' ? 10_000 : 20

export const authRateLimit = {
  max: authMax,
  timeWindow: '1 minute',
  groupId: 'auth',
  keyGenerator: (request: FastifyRequest) => request.ip,
}

export const writeRateLimit = {
  max: 120,
  timeWindow: '1 minute',
  groupId: 'write',
  keyGenerator: (request: FastifyRequest) => request.auth?.userId ?? request.ip,
}

export const uploadRateLimit = {
  max: 20,
  timeWindow: '10 minutes',
  groupId: 'upload',
  keyGenerator: (request: FastifyRequest) => request.auth?.userId ?? request.ip,
}

export const answerRateLimit = {
  max: 60,
  timeWindow: '1 minute',
  groupId: 'answer',
  keyGenerator: (request: FastifyRequest) => request.auth?.userId ?? request.ip,
}

export const hintRateLimit = {
  max: 60,
  timeWindow: '1 minute',
  groupId: 'hint',
  keyGenerator: (request: FastifyRequest) => request.auth?.userId ?? request.ip,
}

export const importRateLimit = {
  max: 5,
  timeWindow: '1 hour',
  groupId: 'import-users',
  keyGenerator: (request: FastifyRequest) => request.auth?.schoolId ?? request.ip,
}

export async function registerRateLimit(app: FastifyInstance): Promise<void> {
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: () => new DomainError('RATE_LIMITED'),
  })
}
