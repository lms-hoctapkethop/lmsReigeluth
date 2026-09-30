import { describe, expect, it } from 'vitest'
import { paragraph } from './rich-text.ts'
import { parseModuleDraft } from './module-draft.ts'

const stem = paragraph('Câu hỏi')
const base = {
  schema: 'module-draft/1',
  title: 'Nháp',
  requirementIds: [] as string[],
  items: [{
    clientKey: 'quiz',
    type: 'quiz',
    title: 'Quiz',
    indent: 0,
    completion: 'none',
    assessment: {
      purpose: 'diagnostic',
      maxAttempts: 1,
      showFeedback: 'after_submit',
      hintsEnabled: false,
      shuffleOptions: false,
      questions: [{
        clientKey: 'q1',
        qtype: 'short_text',
        stem,
        answerKey: { manual: true },
        kcRequired: [],
        kcObservable: ['00000000-0000-4000-8000-000000000001'],
        bloomTarget: 2,
      }],
    },
  }],
}

describe('trường server sở hữu', () => {
  it('client gửi source approvedBy provisional thì 422', () => {
    const withSource = structuredClone(base)
    ;(withSource.items[0]?.assessment.questions[0] as { source?: string }).source = 'teacher'
    expect(parseModuleDraft(withSource, 'input').ok).toBe(false)
    const withApproved = structuredClone(base)
    ;(withApproved.items[0]?.assessment.questions[0] as { approvedBy?: string }).approvedBy = '00000000-0000-4000-8000-000000000002'
    expect(parseModuleDraft(withApproved, 'input').ok).toBe(false)
    const withProvisional = structuredClone(base)
    ;(withProvisional.items[0]?.assessment.questions[0] as { provisional?: boolean }).provisional = true
    expect(parseModuleDraft(withProvisional, 'input').ok).toBe(false)
    expect(parseModuleDraft(base, 'input').ok).toBe(true)
  })
})
