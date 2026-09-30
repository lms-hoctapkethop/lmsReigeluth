import { describe, expect, it } from 'vitest'
import { draftDigest } from './digest.ts'
import { toLearnerRelease } from '../learning/projection.ts'

describe('DIGEST', () => {
  it('hai nháp khác thứ tự khóa và clientKey có cùng digest', () => {
    const left = {
      schema: 'module-draft/1',
      title: 'Lập trình',
      requirementIds: ['00000000-0000-4000-8000-000000000001'],
      items: [{ clientKey: 'mot', type: 'header', title: 'Mở', indent: 0, completion: 'none' }],
    }
    const right = {
      items: [{ completion: 'none', indent: 0, title: 'Mở', type: 'header', clientKey: 'hai' }],
      requirementIds: ['00000000-0000-4000-8000-000000000001'],
      title: 'Lập trình',
      schema: 'module-draft/1',
    }
    expect(draftDigest(left)).toBe(draftDigest(right))
  })
})

describe('chiếu DTO học sinh', () => {
  it('bỏ answerKey rationale optionMisconceptions kcRequired', () => {
    const projected = toLearnerRelease({
      schema: 'module-draft/1',
      title: 'Xem',
      requirementIds: [],
      items: [{
        type: 'quiz',
        assessment: {
          questions: [{
            stem: { format: 'hcn-rich/1', blocks: [] },
            answerKey: { accept: ['zq-sentinel-7781'] },
            rationale: { format: 'hcn-rich/1', blocks: [{ type: 'paragraph', children: [{ text: 'zq-sentinel-7781' }] }] },
            optionMisconceptions: { b: '00000000-0000-4000-8000-000000000099' },
            kcRequired: ['00000000-0000-4000-8000-000000000002'],
            kcObservable: ['00000000-0000-4000-8000-000000000003'],
          }],
        },
      }],
    })
    const text = JSON.stringify(projected)
    expect(text).not.toContain('answerKey')
    expect(text).not.toContain('rationale')
    expect(text).not.toContain('optionMisconceptions')
    expect(text).not.toContain('kcRequired')
    expect(text).not.toContain('zq-sentinel-7781')
  })
})
