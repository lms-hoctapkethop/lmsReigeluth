import { gradeResponse } from './grade.ts'
import { readQuestionKey } from './keys.ts'
import { DomainError } from '../errors.ts'
import { requestDigest } from '../authoring/digest.ts'
import { withIdempotency } from '../idempotency.ts'
import { round3 } from '../round.ts'
import {
  assemble,
  emitAnswered,
  lockAttempt,
  markCompleted,
  openQuiz,
  questionsOf,
  responsesOf,
} from './session.ts'
import type { Db, Meta, Trx } from '../org/support.ts'

function asKey(value: unknown): Parameters<typeof gradeResponse>[1] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DomainError('VALIDATION_FAILED')
  return value as Parameters<typeof gradeResponse>[1]
}

function asResponse(value: unknown): { option?: string; options?: string[]; raw?: string; notLearned?: boolean } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const row = value as Record<string, unknown>
  return {
    ...(typeof row.option === 'string' ? { option: row.option } : {}),
    ...(Array.isArray(row.options) && row.options.every((item) => typeof item === 'string') ? { options: row.options } : {}),
    ...(typeof row.raw === 'string' ? { raw: row.raw } : {}),
    ...(row.notLearned === true ? { notLearned: true } : {}),
  }
}

export async function submitAttempt(db: Db, meta: Meta, attemptId: string, idempotencyKey: string): Promise<Record<string, unknown>> {
  const located = await db
    .selectFrom('quiz_attempts')
    .innerJoin('assessment_versions', 'assessment_versions.id', 'quiz_attempts.assessment_version_id')
    .select(['quiz_attempts.module_release_id', 'assessment_versions.module_item_id'])
    .where('quiz_attempts.id', '=', attemptId)
    .where('quiz_attempts.school_id', '=', meta.actor.schoolId)
    .where('quiz_attempts.learner_id', '=', meta.actor.userId)
    .executeTakeFirst()
  if (!located) throw new DomainError('NOT_FOUND')
  const { release, assessment } = await openQuiz(db, meta, located.module_release_id, located.module_item_id)
  return withIdempotency(db, meta, {
    scope: `submit:${attemptId}`,
    key: idempotencyKey,
    requestHash: requestDigest({ attemptId }),
    run: (trx) => writeSubmit(trx, meta, release.id, release.offering_id, release.due_at, assessment, attemptId),
  })
}

async function writeSubmit(
  trx: Trx,
  meta: Meta,
  releaseId: string,
  offeringId: string,
  dueAt: Date | null,
  assessment: Awaited<ReturnType<typeof openQuiz>>['assessment'],
  attemptId: string,
): Promise<Record<string, unknown>> {
  const attempt = await lockAttempt(trx, attemptId, meta.actor.schoolId, meta.actor.userId)
  if (attempt.status === 'submitted') {
    const view = await assemble(trx, meta, attempt, assessment, dueAt)
    return view.attempt
  }
  const questions = await questionsOf(trx, assessment.id)
  const responses = await responsesOf(trx, attempt.id)
  const last = new Map<string, (typeof responses)[number]>()
  for (const row of responses) {
    const current = last.get(row.question_item_id)
    if (!current || row.try_no >= current.try_no) last.set(row.question_item_id, row)
  }
  let score = 0
  const counted: string[] = []
  for (const question of questions) {
    const row = last.get(question.id)
    if (!row) continue
    counted.push(String(row.id))
    const body = asResponse(row.response)
    if (body.notLearned || row.correct === null) continue
    if (row.points !== null) {
      score += Number(row.points)
      continue
    }
    const key = await readQuestionKey(trx, question.id)
    try {
      const graded = gradeResponse(question.qtype, asKey(key), body)
      score += graded.score
    } catch (error) {
      if (error instanceof Error && error.message === 'VALIDATION_FAILED') continue
      throw error
    }
  }
  const maxScore = questions.length
  const rounded = round3(score)
  await trx
    .updateTable('quiz_attempts')
    .set({
      status: 'submitted',
      submitted_at: meta.clock.now(),
      score: rounded.toFixed(3),
      max_score: maxScore.toFixed(3),
    })
    .where('id', '=', attempt.id)
    .execute()
  await markCompleted(trx, meta, releaseId, assessment.module_item_id, attempt.id)
  if (assessment.purpose !== 'practice' && counted.length > 0) {
    await emitAnswered(trx, {
      schoolId: meta.actor.schoolId,
      attemptId: attempt.id,
      responseIds: counted,
      learnerId: meta.actor.userId,
      offeringId,
      purpose: assessment.purpose,
    })
  }
  const view = await assemble(
    trx,
    meta,
    { ...attempt, status: 'submitted', score: rounded.toFixed(3), max_score: maxScore.toFixed(3) },
    assessment,
    dueAt,
  )
  return view.attempt
}
