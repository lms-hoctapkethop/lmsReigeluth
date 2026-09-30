import { describe, expect, it } from 'vitest'
import type { RequirementDto } from '@hcn/domain'

const requirement = {
  id: '00000000-0000-4000-8000-000000000001',
  code791Stem: '140110.0101a',
  text: 'Viết được chương trình rẽ nhánh đơn giản.',
  subjectCode: '1401',
  grade: 10,
  sourceDoc: 'QD791_PL22_TinHoc',
  sourceLocator: 'Trang 2',
  extraction: 'clean',
  reviewStatus: 'approved',
  revision: '1750000000000000',
} satisfies RequirementDto

describe('snapshot DTO chương trình', () => {
  it('Requirement', () => {
    expect(requirement).toMatchInlineSnapshot(`
      {
        "code791Stem": "140110.0101a",
        "extraction": "clean",
        "grade": 10,
        "id": "00000000-0000-4000-8000-000000000001",
        "reviewStatus": "approved",
        "revision": "1750000000000000",
        "sourceDoc": "QD791_PL22_TinHoc",
        "sourceLocator": "Trang 2",
        "subjectCode": "1401",
        "text": "Viết được chương trình rẽ nhánh đơn giản.",
      }
    `)
  })
})
