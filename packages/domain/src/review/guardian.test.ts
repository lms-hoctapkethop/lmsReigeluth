import { describe, expect, it } from 'vitest'
import { toGuardianChildOverview } from './guardian.ts'

describe('toGuardianChildOverview', () => {
  it('A02 snapshot không có nháp, nội dung bài làm, hay needs', () => {
    const overview = toGuardianChildOverview({
      learnerId: '10000000-0000-4000-8000-000000000011',
      needs: [{ status: 'strong', value: 0.9 }],
      draft: { comment: 'nháp nội bộ', body: 'bài làm chưa nộp' },
      offerings: [
        {
          offeringId: '43000000-0000-4000-8000-000000000001',
          title: 'Tin10A1',
          activity: { completed: 1, required: 2 },
          achievedRequirements: 1,
          totalRequirements: 2,
          body: 'nội dung bài làm',
          reflection: 'suy ngẫm của HS',
          answerKey: 'đáp án',
          publishedFeedback: [
            {
              id: '71000000-0000-4000-8000-000000000001',
              submissionVersionId: '72000000-0000-4000-8000-000000000001',
              publishedAt: '2026-09-15T02:00:00.000Z',
              outcome: 'reviewed',
              comment: 'Rõ ý',
              criteria: [
                {
                  criterionId: '73000000-0000-4000-8000-000000000001',
                  title: 'Rõ ý',
                  level: 'meets',
                  note: null,
                  levels: { meets: 'Rõ', developing: 'Tạm', notYet: 'Chưa' },
                },
              ],
              decisions: [
                {
                  id: '74000000-0000-4000-8000-000000000001',
                  requirementId: '60000000-0000-4000-8000-000000000001',
                  decision: 'achieved',
                  decidedAt: '2026-09-15T02:00:00.000Z',
                  supersedesId: null,
                },
              ],
            },
          ],
          upcoming: [{ title: 'Bài tập', dueAt: '2026-09-16T02:00:00.000Z', href: '/hoc/bai/r/muc/i' }],
        },
      ],
      supports: [{ id: '75000000-0000-4000-8000-000000000001', content: 'Nhắc con luyện tối', status: 'committed', createdAt: '2026-09-15T03:00:00.000Z' }],
    } as unknown as Parameters<typeof toGuardianChildOverview>[0])
    const encoded = JSON.stringify(overview)
    expect(encoded).not.toContain('nháp')
    expect(encoded).not.toContain('nội dung bài')
    expect(encoded).not.toContain('suy ngẫm')
    expect(encoded).not.toContain('đáp án')
    expect(encoded).not.toContain('needs')
    expect(encoded).not.toContain('answerKey')
    expect(encoded).not.toContain('reflection')
    expect(overview).toEqual({
      learnerId: '10000000-0000-4000-8000-000000000011',
      offerings: [
        {
          offeringId: '43000000-0000-4000-8000-000000000001',
          title: 'Tin10A1',
          activity: { completed: 1, required: 2 },
          achievedRequirements: 1,
          totalRequirements: 2,
          publishedFeedback: [
            {
              id: '71000000-0000-4000-8000-000000000001',
              submissionVersionId: '72000000-0000-4000-8000-000000000001',
              publishedAt: '2026-09-15T02:00:00.000Z',
              outcome: 'reviewed',
              comment: 'Rõ ý',
              criteria: [
                {
                  criterionId: '73000000-0000-4000-8000-000000000001',
                  title: 'Rõ ý',
                  level: 'meets',
                  note: null,
                  levels: { meets: 'Rõ', developing: 'Tạm', notYet: 'Chưa' },
                },
              ],
              decisions: [
                {
                  id: '74000000-0000-4000-8000-000000000001',
                  requirementId: '60000000-0000-4000-8000-000000000001',
                  decision: 'achieved',
                  decidedAt: '2026-09-15T02:00:00.000Z',
                  supersedesId: null,
                },
              ],
            },
          ],
          upcoming: [{ title: 'Bài tập', dueAt: '2026-09-16T02:00:00.000Z', href: '/hoc/bai/r/muc/i' }],
        },
      ],
      supports: [{ id: '75000000-0000-4000-8000-000000000001', content: 'Nhắc con luyện tối', status: 'committed', createdAt: '2026-09-15T03:00:00.000Z' }],
    })
  })
})
