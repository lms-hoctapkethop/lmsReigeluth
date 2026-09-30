import { DomainError } from '../errors.ts'
import { requestDigest } from '../authoring/digest.ts'
import { withIdempotency } from '../idempotency.ts'
import { pgCode, type Db, type Meta, type Trx } from '../org/support.ts'
import { answerQuestion } from './answer.ts'
import {
  assemble,
  attemptLimit,
  freezeOrder,
  hintList,
  jsonOrder,
  lockAttempt,
  markStarted,
  openQuiz,
  questionsOf,
} from './session.ts'
import { submitAttempt } from './submit.ts'

export { answerQuestion, submitAttempt }

async function attemptsOf(trx: Trx, learnerId: string, releaseId: string, assessmentId: string) {
  return trx
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
    .where('learner_id', '=', learnerId)
    .where('module_release_id', '=', releaseId)
    .where('assessment_version_id', '=', assessmentId)
    .orderBy('attempt_no')
    .forUpdate()
    .execute()
}

export async function startAttempt(
  db: Db,
  meta: Meta,
  releaseId: string,
  itemId: string,
  idempotencyKey: string,
): Promise<Record<string, unknown>> {
  const { release, assessment } = await openQuiz(db, meta, releaseId, itemId)
  try {
    return await withIdempotency(db, meta, {
      scope: `start:${releaseId}:${itemId}`,
      key: idempotencyKey,
      requestHash: requestDigest({ releaseId, itemId }),
      run: (trx) => createAttempt(trx, meta, release.id, release.due_at, assessment),
    })
  } catch (error) {
    if (pgCode(error) !== '23505') throw error
    const current = await db
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
      .where('learner_id', '=', meta.actor.userId)
      .where('module_release_id', '=', release.id)
      .where('assessment_version_id', '=', assessment.id)
      .where('status', '=', 'in_progress')
      .executeTakeFirst()
    if (!current) throw new DomainError('ATTEMPT_LIMIT_REACHED')
    const view = await assemble(db, meta, current, assessment, release.due_at)
    return view.attempt
  }
}

async function createAttempt(
  trx: Trx,
  meta: Meta,
  releaseId: string,
  dueAt: Date | null,
  assessment: Awaited<ReturnType<typeof openQuiz>>['assessment'],
): Promise<Record<string, unknown>> {
  const rows = await attemptsOf(trx, meta.actor.userId, releaseId, assessment.id)
  const open = rows.find((row) => row.status === 'in_progress')
  if (open) {
    const view = await assemble(trx, meta, open, assessment, dueAt)
    return view.attempt
  }
  const limit = attemptLimit(assessment.purpose, assessment.max_attempts)
  if (limit !== null && rows.length >= limit) throw new DomainError('ATTEMPT_LIMIT_REACHED')
  const questions = await questionsOf(trx, assessment.id)
  const inserted = await trx
    .insertInto('quiz_attempts')
    .values({
      school_id: meta.actor.schoolId,
      learner_id: meta.actor.userId,
      module_release_id: releaseId,
      assessment_version_id: assessment.id,
      attempt_no: rows.length + 1,
      status: 'in_progress',
      option_order: jsonOrder(freezeOrder(questions, assessment.shuffle_options, `${meta.actor.userId}:${rows.length + 1}`)),
      score: null,
      max_score: null,
    })
    .returning([
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
    .executeTakeFirstOrThrow()
  await markStarted(trx, meta, releaseId, assessment.module_item_id, inserted.id)
  const view = await assemble(trx, meta, inserted, assessment, dueAt)
  return view.attempt
}

export async function getAttempt(db: Db, meta: Meta, attemptId: string): Promise<Record<string, unknown>> {
  const row = await db
    .selectFrom('quiz_attempts')
    .innerJoin('assessment_versions', 'assessment_versions.id', 'quiz_attempts.assessment_version_id')
    .innerJoin('module_releases', 'module_releases.id', 'quiz_attempts.module_release_id')
    .select([
      'quiz_attempts.id',
      'quiz_attempts.school_id',
      'quiz_attempts.learner_id',
      'quiz_attempts.module_release_id',
      'quiz_attempts.assessment_version_id',
      'quiz_attempts.attempt_no',
      'quiz_attempts.status',
      'quiz_attempts.option_order',
      'quiz_attempts.score',
      'quiz_attempts.max_score',
      'assessment_versions.module_item_id',
      'module_releases.due_at',
    ])
    .where('quiz_attempts.id', '=', attemptId)
    .executeTakeFirst()
  if (!row || row.school_id !== meta.actor.schoolId || row.learner_id !== meta.actor.userId) throw new DomainError('NOT_FOUND')
  const { assessment, release } = await openQuiz(db, meta, row.module_release_id, row.module_item_id)
  const view = await assemble(db, meta, row, assessment, release.due_at)
  return view.attempt
}

export async function requestHint(db: Db, meta: Meta, attemptId: string, questionId: string): Promise<Record<string, unknown>> {
  const located = await db
    .selectFrom('quiz_attempts')
    .innerJoin('assessment_versions', 'assessment_versions.id', 'quiz_attempts.assessment_version_id')
    .select(['quiz_attempts.module_release_id', 'assessment_versions.module_item_id'])
    .where('quiz_attempts.id', '=', attemptId)
    .where('quiz_attempts.school_id', '=', meta.actor.schoolId)
    .where('quiz_attempts.learner_id', '=', meta.actor.userId)
    .executeTakeFirst()
  if (!located) throw new DomainError('NOT_FOUND')
  const { assessment } = await openQuiz(db, meta, located.module_release_id, located.module_item_id)
  return db.transaction().execute((trx) => writeHint(trx, meta, assessment, attemptId, questionId))
}

async function writeHint(
  trx: Trx,
  meta: Meta,
  assessment: Awaited<ReturnType<typeof openQuiz>>['assessment'],
  attemptId: string,
  questionId: string,
): Promise<Record<string, unknown>> {
  const attempt = await lockAttempt(trx, attemptId, meta.actor.schoolId, meta.actor.userId)
  if (attempt.status !== 'in_progress') throw new DomainError('ALREADY_ANSWERED', { reason: 'SUBMITTED' })
  if (assessment.purpose !== 'practice' || !assessment.hints_enabled) {
    throw new DomainError('ALREADY_ANSWERED', { reason: 'HINTS_DISABLED' })
  }
  const questions = await questionsOf(trx, assessment.id)
  const question = questions.find((row) => row.id === questionId)
  if (!question) throw new DomainError('NOT_FOUND')
  const hints = hintList(question.hints)
  const current = await trx
    .selectFrom('attempt_hint_usage')
    .select(['hints_used'])
    .where('attempt_id', '=', attempt.id)
    .where('question_item_id', '=', questionId)
    .executeTakeFirst()
  const next = (current?.hints_used ?? 0) + 1
  if (next > hints.length || next > 3) throw new DomainError('ALREADY_ANSWERED', { reason: 'NO_MORE_HINTS' })
  const text = hints[next - 1]
  if (!text) throw new DomainError('ALREADY_ANSWERED', { reason: 'NO_MORE_HINTS' })
  if (!current) {
    await trx
      .insertInto('attempt_hint_usage')
      .values({ attempt_id: attempt.id, question_item_id: questionId, hints_used: next })
      .execute()
  } else {
    await trx
      .updateTable('attempt_hint_usage')
      .set({ hints_used: next, updated_at: meta.clock.now() })
      .where('attempt_id', '=', attempt.id)
      .where('question_item_id', '=', questionId)
      .execute()
  }
  return { level: next, text, remaining: Math.max(0, Math.min(hints.length, 3) - next) }
}
