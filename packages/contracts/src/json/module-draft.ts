import { z } from 'zod'
import { parseRichText, richDoc } from './rich-text.ts'

const key = z.string().min(1).max(64)
const rich = richDoc

const singleKey = z.strictObject({ option: z.string().min(1).max(8) })
const multiKey = z.strictObject({
  options: z.array(z.string().min(1).max(8)).min(1).max(8),
  scoring: z.enum(['all_or_nothing', 'partial']),
})
const numericKey = z.strictObject({
  value: z.string().min(1).max(40),
  tolerance: z.string().max(40),
  accept: z.array(z.string().max(40)).max(8).optional(),
  unit: z.string().max(20).nullable().optional(),
})
const shortKey = z.union([
  z.strictObject({ accept: z.array(z.string().min(1).max(200)).min(1).max(20), caseSensitive: z.boolean() }),
  z.strictObject({ manual: z.literal(true) }),
])

const option = z.strictObject({ id: z.string().min(1).max(8), label: z.string().min(1).max(500) })

const questionFields = {
  clientKey: key,
  qtype: z.enum(['single_choice', 'multi_choice', 'numeric', 'short_text']),
  stem: rich,
  options: z.array(option).max(8).optional(),
  answerKey: z.union([singleKey, multiKey, numericKey, shortKey]),
  rationale: rich.optional(),
  kcRequired: z.array(z.string().uuid()).max(10),
  kcObservable: z.array(z.string().uuid()).min(1).max(10),
  bloomTarget: z.number().int().min(1).max(6),
  variantGroup: z.string().max(80).optional(),
  difficultyPrior: z.enum(['easy', 'medium', 'hard']).optional(),
  hints: z.array(z.string().max(500)).max(3).optional(),
  optionMisconceptions: z.record(z.string().max(8), z.string().uuid()).optional(),
}

export const questionInput = z.strictObject(questionFields)
export const questionStored = z.strictObject({
  ...questionFields,
  source: z.enum(['teacher', 'library', 'ai_proposal', 'import']).optional(),
  approvedBy: z.string().uuid().nullable().optional(),
  provisional: z.boolean().optional(),
})

const criterion = z.strictObject({
  title: z.string().min(1).max(200),
  kcVersionId: z.string().uuid().nullable(),
  levels: z.strictObject({
    meets: z.string().min(1).max(1000),
    developing: z.string().min(1).max(1000),
    notYet: z.string().min(1).max(1000),
  }),
})

const rubric = z.strictObject({
  title: z.string().min(1).max(200),
  criteria: z.array(criterion).min(1).max(10),
})

const assessmentOf = (question: z.ZodType) =>
  z.strictObject({
    purpose: z.enum(['diagnostic', 'practice', 'exit_ticket', 'self_assessment', 'summative']),
    maxAttempts: z.number().int().positive().nullable(),
    showFeedback: z.enum(['immediate', 'after_submit', 'after_due', 'never']),
    hintsEnabled: z.boolean(),
    shuffleOptions: z.boolean(),
    questions: z.array(question).max(50),
  })

function itemsOf(question: z.ZodType) {
  const assessment = assessmentOf(question)
  return z.discriminatedUnion('type', [
    z.strictObject({ clientKey: key, type: z.literal('header'), title: z.string().min(1).max(200), indent: z.union([z.literal(0), z.literal(1)]), completion: z.literal('none') }),
    z.strictObject({
      clientKey: key,
      type: z.literal('page'),
      title: z.string().min(1).max(200),
      indent: z.union([z.literal(0), z.literal(1)]),
      completion: z.enum(['none', 'view', 'self_mark']),
      body: rich,
    }),
    z.strictObject({
      clientKey: key,
      type: z.literal('link'),
      title: z.string().min(1).max(200),
      indent: z.union([z.literal(0), z.literal(1)]),
      completion: z.enum(['none', 'view']),
      url: z.string().startsWith('https://').max(2000),
    }),
    z.strictObject({
      clientKey: key,
      type: z.literal('assignment'),
      title: z.string().min(1).max(200),
      indent: z.union([z.literal(0), z.literal(1)]),
      completion: z.enum(['none', 'submit']),
      body: rich,
      requirementIds: z.array(z.string().uuid()).max(20),
      rubric: rubric.optional(),
    }),
    z.strictObject({
      clientKey: key,
      type: z.literal('quiz'),
      title: z.string().min(1).max(200),
      indent: z.union([z.literal(0), z.literal(1)]),
      completion: z.enum(['none', 'submit']),
      assessment,
    }),
  ])
}

function draftOf(question: z.ZodType) {
  return z.strictObject({
    schema: z.literal('module-draft/1'),
    title: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    requirementIds: z.array(z.string().uuid()).max(30),
    items: z.array(itemsOf(question)).max(100),
  }).superRefine((draft, ctx) => {
    const seen = new Set<string>()
    const claim = (clientKey: string, path: (string | number)[]) => {
      if (seen.has(clientKey)) ctx.addIssue({ code: 'custom', message: 'DUPLICATE_CLIENT_KEY', path })
      seen.add(clientKey)
    }
    draft.items.forEach((item, index) => {
      claim(item.clientKey, ['items', index, 'clientKey'])
      if (item.type === 'quiz') {
        item.assessment.questions.forEach((question, questionIndex) => {
          const row = question as { clientKey: string; qtype: string; options?: { id: string }[]; answerKey: unknown }
          claim(row.clientKey, ['items', index, 'assessment', 'questions', questionIndex, 'clientKey'])
          const options = new Set((row.options ?? []).map((option) => option.id))
          if ((row.qtype === 'single_choice' || row.qtype === 'multi_choice') && options.size === 0) {
            ctx.addIssue({ code: 'custom', message: 'OPTIONS_REQUIRED', path: ['items', index, 'assessment', 'questions', questionIndex] })
          }
          if (row.qtype === 'single_choice' && !singleKey.safeParse(row.answerKey).success) {
            ctx.addIssue({ code: 'custom', message: 'ANSWER_KEY', path: ['items', index] })
          }
          if (row.qtype === 'multi_choice' && !multiKey.safeParse(row.answerKey).success) {
            ctx.addIssue({ code: 'custom', message: 'ANSWER_KEY', path: ['items', index] })
          }
          if (row.qtype === 'numeric' && !numericKey.safeParse(row.answerKey).success) {
            ctx.addIssue({ code: 'custom', message: 'ANSWER_KEY', path: ['items', index] })
          }
          if (row.qtype === 'short_text' && !shortKey.safeParse(row.answerKey).success) {
            ctx.addIssue({ code: 'custom', message: 'ANSWER_KEY', path: ['items', index] })
          }
        })
      }
      if (item.type === 'page' || item.type === 'assignment' || item.type === 'quiz') {
        const docs = item.type === 'quiz'
          ? item.assessment.questions.flatMap((question) => {
              const row = question as { stem: unknown; rationale?: unknown }
              return row.rationale ? [row.stem, row.rationale] : [row.stem]
            })
          : [item.body]
        for (const doc of docs) {
          const richResult = parseRichText(doc)
          if (!richResult.ok) ctx.addIssue({ code: 'custom', message: richResult.code, path: ['items', index] })
        }
      }
    })
  })
}

export const moduleDraftInput = draftOf(questionInput)
export const moduleDraftStored = draftOf(questionStored)
export type ModuleDraftInput = z.infer<typeof moduleDraftInput>
export type ModuleDraftStored = z.infer<typeof moduleDraftStored>

export type DraftParse = { ok: true; draft: ModuleDraftStored } | { ok: false; code: 'FEATURE_NOT_ENABLED' | 'VALIDATION_FAILED' }

function containsImage(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some(containsImage)
  const record = value as Record<string, unknown>
  if (record.type === 'image') return true
  return Object.values(record).some(containsImage)
}

export function parseModuleDraft(value: unknown, mode: 'input' | 'stored'): DraftParse {
  if (containsImage(value)) return { ok: false, code: 'FEATURE_NOT_ENABLED' }
  const schema = mode === 'input' ? moduleDraftInput : moduleDraftStored
  const parsed = schema.safeParse(value)
  if (!parsed.success) return { ok: false, code: parsed.error.issues.some((issue) => issue.message === 'FEATURE_NOT_ENABLED') ? 'FEATURE_NOT_ENABLED' : 'VALIDATION_FAILED' }
  return { ok: true, draft: parsed.data as ModuleDraftStored }
}
