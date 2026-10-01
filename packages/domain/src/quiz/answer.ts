import { round3 } from '../round.ts'
import { gradeResponse } from './grade.ts'
import { normalizeNumber } from './normalize.ts'
import { readQuestionKey } from './keys.ts'
import { DomainError } from '../errors.ts'
import { requestDigest } from '../authoring/digest.ts'
import { withIdempotency } from '../idempotency.ts'
import { asJson } from '../json.ts'
import { numericFormatMessage } from './project.ts'
import {
  assemble,
  emitAnswered,
  hintsOf,
  lockAttempt,
  misconceptionForOption,
  openQuiz,
  questionsOf,
  responsesOf,
  type QuestionRow,
} from './session.ts'
import type { Db, Meta, Trx } from '../org/support.ts'

export type AnswerBody = { option?: string; options?: string[]; raw?: string; notLearned?: true }

function asKey(value: unknown): Parameters<typeof gradeResponse>[1] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DomainError('VALIDATION_FAILED')
  return value as Parameters<typeof gradeResponse>[1]
}

function gradeOrReject(question: QuestionRow, key: unknown, response: AnswerBody): { correct: boolean | null; score: number } {
  if (question.qtype === 'numeric') {
    const parsed = normalizeNumber(response.raw)
    if (!parsed.ok) throw new DomainError('VALIDATION_FAILED', { reason: parsed.reason, message: numericFormatMessage })
  }
  try {
    return gradeResponse(question.qtype, asKey(key), {
      ...(response.option !== undefined ? { option: response.option } : {}),
      ...(response.options !== undefined ? { options: response.options } : {}),
      ...(response.raw !== undefined ? { raw: response.raw } : {}),
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'VALIDATION_FAILED') throw new DomainError('VALIDATION_FAILED', { reason: 'RESPONSE' })
    throw error
  }
}

export async function answerQuestion(
  db: Db,
  meta: Meta,
  attemptId: string,
  questionId: string,
  input: { response: AnswerBody; idempotencyKey: string },
): Promise<Record<string, unknown>> {
  const located = await db
    .selectFrom('quiz_attempts')
    .innerJoin('assessment_versions', 'assessment_versions.id', 'quiz_attempts.assessment_version_id')
    .innerJoin('module_releases', 'module_releases.id', 'quiz_attempts.module_release_id')
    .select(['quiz_attempts.module_release_id', 'assessment_versions.module_item_id'])
    .where('quiz_attempts.id', '=', attemptId)
    .where('quiz_attempts.school_id', '=', meta.actor.schoolId)
    .where('quiz_attempts.learner_id', '=', meta.actor.userId)
    .executeTakeFirst()
  if (!located) throw new DomainError('NOT_FOUND')
  const { release, assessment } = await openQuiz(db, meta, located.module_release_id, located.module_item_id)
  return withIdempotency(db, meta, {
    scope: `answer:${attemptId}:${questionId}`,
    key: input.idempotencyKey,
    requestHash: requestDigest({ response: input.response }),
    run: (trx) => writeAnswer(trx, meta, release.offering_id, release.due_at, assessment, attemptId, questionId, input.response),
  })
}

async function writeAnswer(
  trx: Trx,
  meta: Meta,
  offeringId: string,
  dueAt: Date | null,
  assessment: Awaited<ReturnType<typeof openQuiz>>['assessment'],
  attemptId: string,
  questionId: string,
  response: AnswerBody,
): Promise<Record<string, unknown>> {
  const attempt = await lockAttempt(trx, attemptId, meta.actor.schoolId, meta.actor.userId)
  if (attempt.assessment_version_id !== assessment.id) throw new DomainError('NOT_FOUND')
  if (attempt.status !== 'in_progress') throw new DomainError('ALREADY_ANSWERED', { reason: 'SUBMITTED' })
  const questions = await questionsOf(trx, assessment.id)
  const question = questions.find((row) => row.id === questionId)
  if (!question) throw new DomainError('NOT_FOUND')
  const prior = await responsesOf(trx, attempt.id)
  const mine = prior.filter((row) => row.question_item_id === questionId)
  if (assessment.purpose === 'practice' && mine.some((row) => row.correct === true)) {
    throw new DomainError('ALREADY_ANSWERED', { reason: 'ALREADY_CORRECT' })
  }
  if (response.notLearned) {
    if (assessment.purpose === 'practice') throw new DomainError('VALIDATION_FAILED', { reason: 'NOT_LEARNED' })
  }
  const hints = await hintsOf(trx, attempt.id)
  const hintsUsed = hints.find((row) => row.question_item_id === questionId)?.hints_used ?? 0
  let correct: boolean | null = null
  let points: string | null = null
  let misconceptionId: string | null = null
  let feedback: string | null = null
  let misconceptionCode: string | null = null
  if (!response.notLearned) {
    const key = await readQuestionKey(trx, questionId)
    const graded = gradeOrReject(question, key, response)
    correct = graded.correct
    if (correct !== null) points = round3(graded.score).toFixed(3)
    const optionId = typeof response.option === 'string' ? response.option : undefined
    if (correct === false && optionId) {
      const found = await misconceptionForOption(trx, questionId, optionId)
      if (found) {
        misconceptionId = found.id
        feedback = found.description
        misconceptionCode = found.code
      }
    }
  }
  const tryNo = mine.reduce((max, row) => Math.max(max, row.try_no), 0) + 1
  const stored = response.notLearned
    ? { notLearned: true }
    : {
        ...(response.option !== undefined ? { option: response.option } : {}),
        ...(response.options !== undefined ? { options: response.options } : {}),
        ...(response.raw !== undefined ? { raw: response.raw } : {}),
      }
  const inserted = await trx
    .insertInto('question_responses')
    .values({
      school_id: meta.actor.schoolId,
      attempt_id: attempt.id,
      question_item_id: questionId,
      try_no: tryNo,
      response: asJson(stored),
      correct,
      points,
      hints_used: hintsUsed,
      misconception_id: misconceptionId,
    })
    .returning('id')
    .executeTakeFirstOrThrow()
  if (assessment.purpose === 'practice') {
    await emitAnswered(trx, {
      schoolId: meta.actor.schoolId,
      attemptId: attempt.id,
      responseIds: [String(inserted.id)],
      learnerId: meta.actor.userId,
      offeringId,
      purpose: assessment.purpose,
    })
  }
  const revealed = assessment.purpose === 'practice' || assessment.show_feedback === 'immediate'
  const view = await assemble(trx, meta, attempt, assessment, dueAt, {
    questionId,
    tryNo,
    correct,
    feedback,
    misconceptionCode,
    hintsUsed,
    revealed,
  })
  if (!view.answer) throw new DomainError('INTERNAL')
  return view.answer
}
