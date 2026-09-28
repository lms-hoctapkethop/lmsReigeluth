import {
  CRITERIA,
  currentDecisions,
  hashBody,
  HttpError,
  LEARNER,
  notify,
  OUTCOMES,
  outcomeView,
  recordAudit,
  type Db,
} from "@/lib/db"
import type { SessionUser } from "@/lib/session"

export function assertLearnerAccess(db: Db, user: SessionUser) {
  if (user.role === "admin") {
    throw new HttpError(403, "Tài khoản quản trị không mở hồ sơ học tập.")
  }
  if (user.role === "student" && user.id !== LEARNER.id) {
    throw new HttpError(403, "Bạn không có quyền xem hồ sơ này.")
  }
  if (user.role === "guardian") {
    if (user.id !== "guardian-mai" || db.guardianLink.status !== "active" || db.guardianLink.guardianId !== user.id) {
      throw new HttpError(403, "Liên kết phụ huynh chưa có hiệu lực. Hãy liên hệ nhà trường.")
    }
  }
  if (user.role === "teacher" && user.id !== "teacher-ha") {
    throw new HttpError(403, "Bạn chưa được phân công lớp học phần này.")
  }
}

export function context(db: Db) {
  return {
    learner: { ...LEARNER, className: db.org.className },
    course: {
      name: db.org.courseTitle,
      module: db.module.title,
      week: db.org.weekLabel,
    },
    school: db.org.school,
  }
}

export function overview(db: Db, user: SessionUser) {
  assertLearnerAccess(db, user)
  const outcomes = outcomeView(db)
  const confirmed = outcomes.filter((item) => item.status === "met").length
  const latest = db.versions.at(-1) ?? null
  const published = db.reviews.at(-1) ?? null
  const donePlans = db.plans.filter((item) => item.done).length
  const pending = db.plans
    .filter((item) => !item.done)
    .sort((left, right) => left.due.localeCompare(right.due))
  const next = pending[0] ?? null
  const activityDone = [db.exploreDone, db.versions.length > 0, db.quizzes.length > 0].filter(Boolean).length
  const note = published?.criteria.map((item) => item.note).find((item) => item.trim()) ?? ""
  return {
    user,
    ...context(db),
    plans: { done: donePlans, total: db.plans.length },
    weekTasks: db.plans.slice(0, 5).map((item) => ({
      id: item.id,
      title: item.title,
      due: item.due,
      source: item.source,
      done: item.done,
    })),
    nextTask: next
      ? {
          title: next.title,
          due: next.due,
          reason:
            next.source === "assigned"
              ? "Việc được giao chưa hoàn thành, hạn gần nhất còn mở."
              : "Việc cá nhân chưa hoàn thành.",
          href: next.id === "plan-quiz" ? "/assessment" : next.id === "plan-record" ? "/records" : "/learn",
        }
      : null,
    activities: { done: activityDone, total: 3 },
    outcomes: { confirmed, total: outcomes.length, items: outcomes },
    submission: latest
      ? { versionNo: latest.versionNo, receipt: latest.receipt, submittedAt: latest.submittedAt }
      : null,
    feedback: published
      ? {
          teacher: "Nguyễn Hà",
          at: published.publishedAt,
          excerpt: note || "Giáo viên đã công bố nhận xét cho bài thực hành.",
        }
      : null,
    reviewPublished: Boolean(published),
    quizCount: db.quizzes.length,
    exploreDone: db.exploreDone,
    familyNotes: db.familyNotes.length,
    waitingReview: Boolean(latest) && !published,
  }
}

export function learnPayload(db: Db, user: SessionUser) {
  assertLearnerAccess(db, user)
  const latest = db.versions.at(-1) ?? null
  const review = db.reviews.at(-1) ?? null
  const canEdit = user.role === "student"
  return {
    ...context(db),
    canEdit,
    exploreDone: db.exploreDone,
    explore: {
      title: db.module.exploreTitle,
      body: db.module.exploreBody,
    },
    practice: {
      title: db.module.practiceTitle,
      prompt: db.module.practicePrompt,
      draft: canEdit || user.role === "teacher" ? db.draft : undefined,
      latest: latest
        ? {
            versionNo: latest.versionNo,
            code: latest.code,
            reflection: latest.reflection,
            submittedAt: latest.submittedAt,
            receipt: latest.receipt,
          }
        : null,
    },
    review:
      review && (user.role !== "student" || true)
        ? {
            versionNo: review.versionNo,
            publishedAt: review.publishedAt,
            criteria: review.criteria,
          }
        : null,
    quiz: db.module.quiz.map(({ id, prompt, choices }) => ({ id, prompt, choices })),
    lastQuiz: db.quizzes.at(-1) ?? null,
  }
}

export function saveDraft(db: Db, user: SessionUser, input: { code: string; reflection: string; version: number }) {
  assertLearnerAccess(db, user)
  if (user.role !== "student") throw new HttpError(403, "Chỉ học sinh lưu được bản nháp của mình.")
  if (input.version !== db.draft.version) {
    throw new HttpError(409, "Bản nháp trên máy chủ đã mới hơn. Hãy tải lại trước khi lưu.", {
      draft: db.draft,
    })
  }
  db.draft = {
    learnerId: LEARNER.id,
    code: input.code.slice(0, 8000),
    reflection: input.reflection.slice(0, 4000),
    version: db.draft.version + 1,
    updatedAt: new Date().toISOString(),
  }
  return { saved: true, draft: db.draft }
}

export function submitWork(
  db: Db,
  user: SessionUser,
  input: { code: string; reflection: string; version: number; idempotencyKey: string },
) {
  assertLearnerAccess(db, user)
  if (user.role !== "student") throw new HttpError(403, "Chỉ học sinh nộp được bài của mình.")
  const key = `${user.id}:submit:${input.idempotencyKey}`
  const existing = db.idempotency[key]
  if (existing) return { receipt: existing, duplicate: true }
  if (!input.code.trim() || input.reflection.trim().length < 12) {
    throw new HttpError(400, "Cần có mã và một nhận xét đủ để người khác hiểu lựa chọn của bạn.")
  }
  if (input.version !== db.draft.version) {
    throw new HttpError(409, "Bản nháp đã đổi. Hãy lưu lại hoặc tải bản mới trước khi nộp.", {
      draft: db.draft,
    })
  }
  const versionNo = (db.versions.at(-1)?.versionNo ?? 0) + 1
  const submittedAt = new Date().toISOString()
  const receipt = `HCN-${submittedAt.slice(0, 10).replaceAll("-", "")}-${hashBody(input.code, input.reflection).slice(0, 6).toUpperCase()}`
  db.versions.push({
    versionNo,
    code: input.code.slice(0, 8000),
    reflection: input.reflection.slice(0, 4000),
    submittedAt,
    receipt,
  })
  db.draft = {
    ...db.draft,
    code: input.code.slice(0, 8000),
    reflection: input.reflection.slice(0, 4000),
    version: db.draft.version + 1,
    updatedAt: submittedAt,
  }
  db.idempotency[key] = { receipt, versionNo, submittedAt }
  const plan = db.plans.find((item) => item.id === "plan-practice")
  if (plan) plan.done = true
  notify(db, {
    userId: "teacher-ha",
    title: "Có bài mới chờ phản hồi",
    summary: `${LEARNER.name} đã nộp lần ${versionNo}. Mở bài để đọc và phản hồi.`,
    href: "/assessment",
  })
  recordAudit(db, { actorId: user.id, actorName: user.name, action: "Nộp bài", target: `Lần nộp ${versionNo}` })
  return { receipt: db.idempotency[key], duplicate: false }
}

export function markExplore(db: Db, user: SessionUser) {
  assertLearnerAccess(db, user)
  if (user.role !== "student") throw new HttpError(403, "Chỉ học sinh ghi nhận được việc đã đọc.")
  db.exploreDone = true
  const plan = db.plans.find((item) => item.id === "plan-read")
  if (plan) plan.done = true
  return { exploreDone: true }
}

export function gradeQuiz(db: Db, user: SessionUser, answers: number[]) {
  assertLearnerAccess(db, user)
  if (user.role !== "student") throw new HttpError(403, "Chỉ học sinh làm được bài luyện tập này.")
  const quiz = db.module.quiz
  if (
    answers.length !== quiz.length ||
    answers.some((value, index) => !Number.isInteger(value) || value < 0 || value >= quiz[index].choices.length)
  ) {
    throw new HttpError(400, "Hãy chọn một đáp án cho mỗi câu.")
  }
  const explanations = quiz.map((question, index) => ({
    id: question.id,
    correct: answers[index] === question.answer,
    explain: question.explain,
  }))
  const score = explanations.filter((item) => item.correct).length
  const attempt = {
    id: `quiz-${db.quizzes.length + 1}`,
    answers,
    score,
    total: quiz.length,
    submittedAt: new Date().toISOString(),
    explanations,
  }
  db.quizzes.push(attempt)
  const plan = db.plans.find((item) => item.id === "plan-quiz")
  if (plan) plan.done = true
  return {
    attempt,
    note: "Điểm luyện tập không tự xác nhận mục tiêu thực hành.",
  }
}

export function publishReview(
  db: Db,
  user: SessionUser,
  input: { versionNo: number; marks: { id: string; met: boolean; note: string }[] },
) {
  assertLearnerAccess(db, user)
  if (user.role !== "teacher") throw new HttpError(403, "Chỉ giáo viên được phân công mới công bố nhận xét.")
  const version = db.versions.find((item) => item.versionNo === input.versionNo)
  if (!version) throw new HttpError(404, "Không thấy lần nộp này.")
  const criteria = CRITERIA.map((criterion) => {
    const mark = input.marks.find((item) => item.id === criterion.id)
    return {
      id: criterion.id,
      label: criterion.label,
      met: Boolean(mark?.met),
      note: (mark?.note ?? "").slice(0, 500),
    }
  })
  const publishedAt = new Date().toISOString()
  db.reviews.push({
    id: `review-${db.reviews.length + 1}`,
    versionNo: version.versionNo,
    reviewerId: user.id,
    criteria,
    publishedAt,
  })
  for (const criterion of CRITERIA) {
    const mark = criteria.find((item) => item.id === criterion.id)!
    for (const outcomeId of criterion.outcomes) {
      const previous = currentDecisions(db).find((item) => item.outcomeId === outcomeId)
      db.decisions.push({
        id: `decision-${db.decisions.length + 1}`,
        outcomeId,
        decision: mark.met ? "met" : "not_met",
        reason: mark.met ? `Đạt tiêu chí “${criterion.label}” ở lần nộp ${version.versionNo}.` : `Chưa đạt tiêu chí “${criterion.label}”.`,
        decidedBy: user.id,
        decidedAt: publishedAt,
        supersedesId: previous?.id,
      })
    }
  }
  const plan = db.plans.find((item) => item.id === "plan-record")
  if (plan) plan.done = true
  const summary = "Bài thực hành đã có phản hồi. Mở bài để đọc nhận xét."
  notify(db, { userId: LEARNER.id, title: "Giáo viên đã công bố phản hồi", summary, href: "/learn" })
  if (db.guardianLink.status === "active") {
    notify(db, { userId: db.guardianLink.guardianId, title: "Có phản hồi mới về bài của con", summary, href: "/records" })
  }
  recordAudit(db, { actorId: user.id, actorName: user.name, action: "Công bố phản hồi", target: `Lần nộp ${version.versionNo}` })
  return { publishedAt, outcomes: outcomeView(db) }
}

export function recordsPayload(db: Db, user: SessionUser) {
  assertLearnerAccess(db, user)
  return {
    ...context(db),
    outcomes: outcomeView(db),
    versions: db.versions.map((item) => ({
      versionNo: item.versionNo,
      submittedAt: item.submittedAt,
      receipt: item.receipt,
    })),
    reviews: db.reviews,
    quizCount: db.quizzes.length,
    note: "Hoàn thành một thao tác và được xác nhận đạt mục tiêu là hai việc khác nhau.",
  }
}

export function teachingPayload(db: Db) {
  const latest = db.versions.at(-1) ?? null
  const review = db.reviews.find((item) => item.versionNo === latest?.versionNo) ?? null
  return {
    ...context(db),
    learner: LEARNER,
    latest,
    review,
    criteria: CRITERIA.map(({ id, label }) => ({ id, label })),
    outcomes: outcomeView(db),
    roster: [{ name: LEARNER.name, className: db.org.className, course: db.org.courseTitle }],
  }
}

