import { describe, expect, it } from 'vitest'
import { DomainError } from '../errors.ts'
import { seedCurriculum } from './seedCurriculum.ts'

describe('seed-curriculum production', () => {
  it('từ chối đường dẫn db/seeds/test/', async () => {
    const previous = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      await expect(seedCurriculum({} as never, 'db/seeds/test/curriculum_fixture.json')).rejects.toBeInstanceOf(DomainError)
      await expect(seedCurriculum({} as never, 'db/seeds/test/curriculum_fixture.json')).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        details: { reason: 'TEST_SEED' },
      })
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = previous
    }
  })
})
