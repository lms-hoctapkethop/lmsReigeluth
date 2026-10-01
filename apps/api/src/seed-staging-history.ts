import type { Kysely } from 'kysely'
import type { Database } from '@hcn/db'
import {
  answerQuestion,
  createModule,
  DomainError,
  enrollLearners,
  publishModuleVersion,
  releaseModules,
  saveModuleDraft,
  saveSubmissionDraft,
  startAttempt,
  submitAssignment,
  submitAttempt,
  systemClock,
  type Actor,
  type IdpAdmin,
} from '@hcn/domain'
import { stagingObservations, stagingStudents, stagingSubmissions } from './seed-staging.ts'

export const historyAssignmentItems = 9

export type ApprovedLink = { requirementId: string; kcVersionId: string }

export function requireApprovedLink(link: ApprovedLink | undefined): ApprovedLink {
  if (!link) {
    throw new Error('Chưa có requirement_kc_links đã duyệt. Ops chạy seed-curriculum trước khi seed-staging.')
  }
  return link
}

export function submissionSlot(index: number, students: number, items: number): { student: number; item: number } {
  const item = Math.floor(index / students)
  if (item < 0 || item >= items) throw new Error('không đủ mục bài tập cho lịch sử')
  return { student: index % students, item }
}

export async function fillStagingHistory(input: {
  submissions: number
  observations: number
  existingSubmissions: number
  existingObservations: number
  submit: (index: number) => Promise<void>
  observe: (index: number) => Promise<void>
}): Promise<{ submissions: number; observations: number }> {
  for (let index = input.existingSubmissions; index < input.submissions; index += 1) {
    await input.submit(index)
  }
  for (let index = input.existingObservations; index < input.observations; index += 1) {
    await input.observe(index)
  }
  return { submissions: input.submissions, observations: input.observations }
}

function rich(text: string) {
  return { format: 'hcn-rich/1', blocks: [{ type: 'paragraph', children: [{ text }] }] }
}

function meta(actor: Actor, requestId: string) {
  return { actor, requestId, clock: systemClock }
}

async function countSubmissions(db: Kysely<Database>, schoolId: string): Promise<number> {
  const row = await db
    .selectFrom('submission_versions')
    .innerJoin('submissions', 'submissions.id', 'submission_versions.submission_id')
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .where('submissions.school_id', '=', schoolId)
    .executeTakeFirstOrThrow()
  return Number(row.n)
}

async function countObservations(db: Kysely<Database>, schoolId: string): Promise<number> {
  const row = await db.selectFrom('observations').select((eb) => eb.fn.countAll<string>().as('n')).where('school_id', '=', schoolId).executeTakeFirstOrThrow()
  return Number(row.n)
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

export async function writeStagingHistory(
  db: Kysely<Database>,
  idp: IdpAdmin,
  input: { schoolId: string; adminId: string; teacherId: string; offeringId: string; courseId: string },
): Promise<{ submissions: number; observations: number }> {
  const admin = meta({ userId: input.adminId, schoolId: input.schoolId, roles: ['admin'] }, 'seed-staging-history')
  const teacher = meta({ userId: input.teacherId, schoolId: input.schoolId, roles: ['teacher'] }, 'seed-staging-history')
  const link = requireApprovedLink(
    await db
      .selectFrom('requirement_kc_links')
      .innerJoin('kc_versions', 'kc_versions.id', 'requirement_kc_links.kc_version_id')
      .select(['requirement_kc_links.requirement_id as requirementId', 'requirement_kc_links.kc_version_id as kcVersionId'])
      .where('requirement_kc_links.status', '=', 'approved')
      .where('kc_versions.status', '=', 'approved')
      .executeTakeFirst(),
  )
  const students: string[] = []
  for (let index = 1; index <= stagingStudents; index += 1) {
    const account = await idp.findByUsername(`stg.hs${String(index).padStart(4, '0')}`)
    if (!account) throw new Error(`thiếu tài khoản stg.hs${String(index).padStart(4, '0')}`)
    students.push(account.id)
  }
  let versionId: string | undefined
  const published = await db
    .selectFrom('module_versions')
    .select(['id'])
    .where('school_id', '=', input.schoolId)
    .where('title', '=', 'Lịch sử thử')
    .executeTakeFirst()
  if (published) versionId = published.id
  else {
    const created = await createModule(db, teacher, { courseId: input.courseId, title: 'Lịch sử thử', requirementIds: [link.requirementId] })
    const items = []
    for (let index = 0; index < historyAssignmentItems; index += 1) {
      items.push({
        clientKey: `bai-${index}`,
        type: 'assignment',
        title: `Bài ${index + 1}`,
        indent: 0,
        completion: 'submit',
        body: rich('Nêu một ví dụ ngắn'),
        requirementIds: [],
        submission: { types: ['text'], allowFiles: false, maxFiles: 0 },
      })
    }
    items.push({
      clientKey: 'luyen',
      type: 'quiz',
      title: 'Luyện tập',
      indent: 0,
      completion: 'submit',
      assessment: {
        purpose: 'practice',
        maxAttempts: null,
        showFeedback: 'immediate',
        hintsEnabled: true,
        shuffleOptions: false,
        questions: [{
          clientKey: 'c1',
          qtype: 'numeric',
          stem: rich('1 + 0'),
          answerKey: { value: '1', tolerance: '0' },
          kcRequired: [],
          kcObservable: [link.kcVersionId],
          bloomTarget: 1,
          hints: ['Cộng với không'],
          source: 'teacher',
        }],
      },
    })
    const saved = await saveModuleDraft(db, teacher, created.moduleId, `W/"${created.revision}"`, {
      schema: 'module-draft/1',
      title: 'Lịch sử thử',
      requirementIds: [link.requirementId],
      items,
    })
    const summary = await publishModuleVersion(db, teacher, created.moduleId, {
      expectedRevision: saved.revision,
      acknowledgements: [],
      idempotencyKey: 'seed-staging-publish-history',
    })
    versionId = summary.id
  }
  const assignmentItems = (
    await db
      .selectFrom('module_items')
      .select(['id'])
      .where('module_version_id', '=', versionId)
      .where('item_type', '=', 'assignment')
      .orderBy('position')
      .execute()
  ).map((row) => row.id)
  const quizItem = await db
    .selectFrom('module_items')
    .select(['id'])
    .where('module_version_id', '=', versionId)
    .where('item_type', '=', 'quiz')
    .executeTakeFirstOrThrow()
  if (assignmentItems.length < historyAssignmentItems) throw new Error('module lịch sử thiếu bài tập')
  let releaseId = (
    await db.selectFrom('module_releases').select(['id']).where('module_version_id', '=', versionId).executeTakeFirst()
  )?.id
  if (!releaseId) {
    const released = await releaseModules(db, teacher, input.offeringId, {
      title: 'Lịch sử thử',
      modules: [{ moduleVersionId: versionId, availableFrom: '2026-09-01T00:00:00.000Z', dueAt: '2027-05-31T00:00:00.000Z' }],
      idempotencyKey: 'seed-staging-release-history',
    })
    releaseId = released.moduleReleaseIds[0]
  }
  if (!releaseId) throw new Error('không công bố được module lịch sử')
  const enrolled = new Set(
    (await db.selectFrom('offering_enrollments').select(['learner_id']).where('offering_id', '=', input.offeringId).where('status', '=', 'active').execute()).map(
      (row) => row.learner_id,
    ),
  )
  const missing = students.filter((id) => !enrolled.has(id))
  for (let offset = 0; offset < missing.length; offset += 400) {
    await enrollLearners(db, admin, { offeringId: input.offeringId, learnerIds: missing.slice(offset, offset + 400) })
  }
  const existingSubmissions = await countSubmissions(db, input.schoolId)
  await fillStagingHistory({
    submissions: stagingSubmissions,
    observations: 0,
    existingSubmissions,
    existingObservations: 0,
    submit: async (index) => {
      const slot = submissionSlot(index, students.length, assignmentItems.length)
      const learnerId = students[slot.student]
      const itemId = assignmentItems[slot.item]
      if (!learnerId || !itemId) throw new Error('thiếu học sinh hoặc mục bài')
      const already = await db
        .selectFrom('submissions')
        .select(['id'])
        .where('learner_id', '=', learnerId)
        .where('module_release_id', '=', releaseId)
        .where('module_item_id', '=', itemId)
        .executeTakeFirst()
      if (already) return
      const student = meta({ userId: learnerId, schoolId: input.schoolId, roles: ['student'] }, 'seed-staging-history')
      const draft = await saveSubmissionDraft(db, student, releaseId, itemId, 'W/"0"', { body: { type: 'text', text: `Bài tổng hợp ${index}` } })
      const revision = draft.draftRevision
      if (typeof revision !== 'number') throw new Error('nháp không có revision')
      await submitAssignment(db, student, releaseId, itemId, { draftRevision: revision, idempotencyKey: `seed-sub-${index}` })
    },
    observe: async () => {},
  })
  let observations = await countObservations(db, input.schoolId)
  let cursor = observations
  while (cursor < stagingObservations) {
    const batchEnd = Math.min(stagingObservations, cursor + 20)
    for (let index = cursor; index < batchEnd; index += 1) {
      const learnerId = students[index % students.length]
      if (!learnerId) throw new Error('thiếu học sinh')
      const student = meta({ userId: learnerId, schoolId: input.schoolId, roles: ['student'] }, 'seed-staging-history')
      try {
        const started = await startAttempt(db, student, releaseId, quizItem.id, `seed-obs-${index}-start`)
        const attempt = started.id
        const questions = started.questions
        const questionId = Array.isArray(questions) ? (questions[0] as { id?: string } | undefined)?.id : undefined
        if (typeof attempt !== 'string' || !questionId) throw new Error('startAttempt không trả câu hỏi')
        try {
          await answerQuestion(db, student, attempt, questionId, { response: { raw: '1' }, idempotencyKey: `seed-obs-${index}-answer` })
        } catch (error) {
          if (!(error instanceof DomainError) || error.code !== 'ALREADY_ANSWERED') throw error
        }
        await submitAttempt(db, student, attempt, `seed-obs-${index}-submit`)
      } catch (error) {
        if (!(error instanceof DomainError) || error.code !== 'IDEMPOTENCY_KEY_REUSED') throw error
      }
    }
    const deadline = Date.now() + 120_000
    observations = await countObservations(db, input.schoolId)
    while (observations < batchEnd && Date.now() < deadline) {
      await sleep(2_000)
      observations = await countObservations(db, input.schoolId)
    }
    if (observations < batchEnd) {
      throw new Error(`Worker chưa tạo đủ quan sát (${observations}/${stagingObservations}). Kiểm tra worker staging rồi chạy lại seed.`)
    }
    cursor = observations
  }
  return { submissions: await countSubmissions(db, input.schoolId), observations }
}
