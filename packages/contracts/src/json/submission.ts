import { z } from 'zod'
import { richDoc } from './rich-text.ts'

const testCase = z.strictObject({
  input: z.string().max(2000),
  expected: z.string().max(2000),
  actual: z.string().max(2000).optional(),
  note: z.string().max(2000).optional(),
})

const textBody = z.strictObject({
  type: z.literal('text'),
  text: z.string().max(100_000),
})

const codeBody = z.strictObject({
  type: z.literal('code'),
  language: z.enum(['python', 'sql', 'html', 'css', 'text']),
  text: z.string().max(100_000),
  testCases: z.array(testCase).max(30).optional(),
})

const richBody = z.strictObject({
  type: z.literal('rich'),
  doc: richDoc,
})

export const submissionBodyInput = z.strictObject({
  body: z.discriminatedUnion('type', [textBody, codeBody, richBody]),
  reflection: z.string().max(2000).optional(),
  fileIds: z.array(z.string().uuid()).max(10).optional(),
}).superRefine((value, ctx) => {
  const ids = value.fileIds ?? []
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({ code: 'custom', message: 'DUPLICATE_FILE', path: ['fileIds'] })
  }
})

export const submitAssignmentInput = z.strictObject({
  draftRevision: z.number().int().min(1),
})

export type SubmissionBodyInput = z.infer<typeof submissionBodyInput>
export type SubmitAssignmentInput = z.infer<typeof submitAssignmentInput>
