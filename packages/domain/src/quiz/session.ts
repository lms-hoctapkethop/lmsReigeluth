import { sql } from 'kysely'
import { DomainError } from '../errors.ts'
import { asJson } from '../json.ts'
import { loadRelease, requireStudentAction, type ReleaseRow } from '../learning/gate.ts'
import { outbox, type Db, type Meta, type Trx } from '../org/support.ts'
import { asOptions, feedbackVisible, hintTexts, toLearnerAttempt, type AnswerFields, type Purpose, type ShowFeedback } from './project.ts'

export type { Purpose, ShowFeedback }

export type AssessmentRow = {
  id: string
  module_item_id: string
  purpose: Purpose
  max_attempts: number | null
  show_feedback: ShowFeedback
  hints_enabled: boolean
  shuffle_options: boolean
}

export type QuestionRow = {
  id: string
  qtype: 'single_choice' | 'multi_choice' | 'numeric' | 'short_text'
  stem: unknown
  options: unknown
  bloom_target: number
  hints: unknown
}

export type AttemptRow = {
  id: string
  school_id: string
  learner_id: string
  module_release_id: string
  assessment_version_id: string
  attempt_no: number
  status: 'in_progress' | 'submitted'
  option_order: unknown
  score: string | number | null
  max_score: string | number | null
}

export type ResponseRow = {
  id: string
  question_item_id: string
  try_no: number
  response: unknown
  correct: boolean | null
  points: string | null
  hints_used: number
  misconception_id: string | null
}

export function attemptLimit(purpose: Purpose, maxAttempts: number | null): number | null {
  if (maxAttempts !== null) return maxAttempts
  if (purpose === 'diagnostic' || purpose === 'exit_ticket') return 1
  return null
}

export function asOrder(value: unknown): Record<string, string[]> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const out: Record<string, string[]> = {}
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (Array.isArray(child) && child.every((item) => typeof item === 'string')) out[key] = child
  }
  return out
}

export function shuffleIds(ids: string[], seed: string): string[] {
  const copy = [...ids]
  let hash = 0
  for (const char of seed) hash = (hash * 33 + char.charCodeAt(0)) >>> 0
  for (let index = copy.length - 1; index > 0; index -= 1) {
    hash = (hash * 1664525 + 1013904223) >>> 0
    const swap = hash % (index + 1)
    const left = copy[index]
    const right = copy[swap]
    if (left === undefined || right === undefined) continue
    copy[index] = right
    copy[swap] = left
  }
  return copy
}

export async function openQuiz(db: Db | Trx, meta: Meta, releaseId: string, itemId: string): Promise<{ release: ReleaseRow; assessment: AssessmentRow }> {
  const release = await loadRelease(db, meta.actor.schoolId, releaseId)
  await requireStudentAction(db, meta, release, 'attempt.*')
  const item = await db
    .selectFrom('module_items')
    .select(['id', 'item_type'])
    .where('module_version_id', '=', release.module_version_id)
    .where('id', '=', itemId)
    .executeTakeFirst()
  if (!item || item.item_type !== 'quiz') throw new DomainError('NOT_FOUND')
  const assessment = await db
    .selectFrom('assessment_versions')
    .select(['id', 'module_item_id', 'purpose', 'max_attempts', 'show_feedback', 'hints_enabled', 'shuffle_options'])
    .where('module_item_id', '=', item.id)
    .executeTakeFirst()
  if (!assessment) throw new DomainError('NOT_FOUND')
  return { release, assessment }
}

export async function questionsOf(db: Db | Trx, assessmentId: string): Promise<QuestionRow[]> {
  return db
    .selectFrom('question_items')
    .select(['id', 'qtype', 'stem', 'options', 'bloom_target', 'hints'])
    .where('assessment_version_id', '=', assessmentId)
    .orderBy('position')
    .execute()
}

export async function lockAttempt(trx: Trx, attemptId: string, schoolId: string, learnerId: string): Promise<AttemptRow> {
  const row = await trx
    .selectFrom('quiz_attempts')
    .select([
      'id',
      'school_id',
      'learner_id',
      'module_release_id',
      'assessment_version_id',
      'attempt_no',
      'status',
      'option_order',
      'score',
      'max_score',
    ])
    .where('id', '=', attemptId)
    .where('school_id', '=', schoolId)
    .forUpdate()
    .executeTakeFirst()
  if (!row || row.learner_id !== learnerId) throw new DomainError('NOT_FOUND')
  return row
}

export async function responsesOf(db: Db | Trx, attemptId: string): Promise<ResponseRow[]> {
  return db
    .selectFrom('question_responses')
    .select(['id', 'question_item_id', 'try_no', 'response', 'correct', 'points', 'hints_used', 'misconception_id'])
    .where('attempt_id', '=', attemptId)
    .orderBy('try_no')
    .execute()
}

export async function hintsOf(db: Db | Trx, attemptId: string): Promise<{ question_item_id: string; hints_used: number }[]> {
  return db
    .selectFrom('attempt_hint_usage')
    .select(['question_item_id', 'hints_used'])
    .where('attempt_id', '=', attemptId)
    .execute()
}

export async function feedbackByMisconception(db: Db | Trx, ids: string[]): Promise<Map<string, { code: string; description: string }>> {
  if (ids.length === 0) return new Map()
  const rows = await db.selectFrom('misconceptions').select(['id', 'code', 'description']).where('id', 'in', ids).execute()
  return new Map(rows.map((row) => [row.id, { code: row.code, description: row.description }]))
}

export async function misconceptionForOption(
  db: Db | Trx,
  questionId: string,
  optionId: string,
): Promise<{ id: string; code: string; description: string } | undefined> {
  const row = await db
    .selectFrom('option_misconceptions')
    .innerJoin('misconceptions', 'misconceptions.id', 'option_misconceptions.misconception_id')
    .select(['misconceptions.id', 'misconceptions.code', 'misconceptions.description'])
    .where('option_misconceptions.question_item_id', '=', questionId)
    .where('option_misconceptions.option_id', '=', optionId)
    .executeTakeFirst()
  return row
}

export function freezeOrder(questions: QuestionRow[], shuffle: boolean, seed: string): Record<string, string[]> | null {
  if (!shuffle) return null
  const order: Record<string, string[]> = {}
  for (const question of questions) {
    order[question.id] = shuffleIds(asOptions(question.options).map((option) => option.id), `${seed}:${question.id}`)
  }
  return order
}

export async function markStarted(trx: Trx, meta: Meta, releaseId: string, itemId: string, attemptId: string): Promise<void> {
  const now = meta.clock.now()
  await trx
    .insertInto('activity_progress')
    .values({
      school_id: meta.actor.schoolId,
      learner_id: meta.actor.userId,
      module_release_id: releaseId,
      module_item_id: itemId,
      status: 'in_progress',
      completion_rule: 'submit',
      source_event: `quiz_attempt:${attemptId}`,
      completed_at: null,
      updated_at: now,
    })
    .onConflict((conflict) => conflict.columns(['learner_id', 'module_release_id', 'module_item_id']).doNothing())
    .execute()
}

export async function markCompleted(trx: Trx, meta: Meta, releaseId: string, itemId: string, attemptId: string): Promise<void> {
  const now = meta.clock.now()
  const source = `quiz_attempt:${attemptId}`
  await trx
    .insertInto('activity_progress')
    .values({
      school_id: meta.actor.schoolId,
      learner_id: meta.actor.userId,
      module_release_id: releaseId,
      module_item_id: itemId,
      status: 'completed',
      completion_rule: 'submit',
      source_event: source,
      completed_at: now,
      updated_at: now,
    })
    .onConflict((conflict) =>
      conflict.columns(['learner_id', 'module_release_id', 'module_item_id']).doUpdateSet({
        status: 'completed',
        source_event: source,
        updated_at: now,
        completed_at: sql`coalesce(activity_progress.completed_at, ${now})`,
      }),
    )
    .execute()
}

export async function emitAnswered(
  trx: Trx,
  input: { schoolId: string; attemptId: string; responseIds: string[]; learnerId: string; offeringId: string; purpose: string },
): Promise<void> {
  await outbox(trx, {
    schoolId: input.schoolId,
    aggregateType: 'quiz_attempt',
    aggregateId: input.attemptId,
    eventType: 'QuestionAnswered',
    payload: {
      responseIds: input.responseIds.join(','),
      attemptId: input.attemptId,
      learnerId: input.learnerId,
      offeringId: input.offeringId,
      purpose: input.purpose,
    },
  })
}

export function jsonOrder(order: Record<string, string[]> | null) {
  return order ? asJson(order) : null
}

export function hintList(value: unknown): string[] {
  return hintTexts(value)
}

function num(value: string | number | null): number | null {
  if (value === null) return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export async function assemble(
  db: Db | Trx,
  meta: Meta,
  attempt: AttemptRow,
  assessment: AssessmentRow,
  dueAt: Date | null,
  answer?: AnswerFields,
): Promise<{ attempt: Record<string, unknown>; answer: Record<string, unknown> | null }> {
  const questions = await questionsOf(db, attempt.assessment_version_id)
  const responses = await responsesOf(db, attempt.id)
  const hints = await hintsOf(db, attempt.id)
  const labels = await feedbackByMisconception(
    db,
    responses.flatMap((row) => (row.misconception_id ? [row.misconception_id] : [])),
  )
  const revealed = (questionId: string) =>
    feedbackVisible({
      purpose: assessment.purpose,
      showFeedback: assessment.show_feedback,
      status: attempt.status,
      dueAt,
      now: meta.clock.now(),
    }) && responses.some((row) => row.question_item_id === questionId)
  return toLearnerAttempt({
    id: attempt.id,
    purpose: assessment.purpose,
    attemptNo: attempt.attempt_no,
    status: attempt.status,
    score: num(attempt.score),
    maxScore: num(attempt.max_score),
    optionOrder: asOrder(attempt.option_order),
    questions: questions.map((question) => ({
      id: question.id,
      qtype: question.qtype,
      stem: question.stem,
      options: question.options,
      bloomTarget: question.bloom_target,
      hints: question.hints,
    })),
    responses: responses.map((row) => ({
      questionId: row.question_item_id,
      tryNo: row.try_no,
      response: row.response,
      correct: row.correct,
      hintsUsed: row.hints_used,
      feedback: row.misconception_id ? (labels.get(row.misconception_id)?.description ?? null) : null,
    })),
    hints: hints.map((row) => ({ questionId: row.question_item_id, hintsUsed: row.hints_used })),
    revealed,
    ...(answer ? { answer } : {}),
  })
}
