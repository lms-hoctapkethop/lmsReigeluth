import {
  COURSE,
  CRITERIA,
  currentDecisions,
  hashBody,
  HttpError,
  LEARNER,
  OUTCOMES,
  outcomeView,
  QUIZ,
  type Db,
} from "@/lib/db"
import type { SessionUser } from "@/lib/session"

export function assertLearnerAccess(user: SessionUser) {
  if (user.role === "student" && user.id !== LEARNER.id) {
    throw new HttpError(403, "Bạn không có quyền xem hồ sơ này.")
  }
  if (user.role === "guardian" && user.id !== "guardian-mai") {
    throw new HttpError(403, "Liên kết phụ huynh không còn hiệu lực.")
  }
  if (user.role === "teacher" && user.id !== "teacher-ha") {
    throw new HttpError(403, "Bạn chưa được phân công lớp học phần này.")
  }
}

export function context() {
  return {
    learner: LEARNER,
    course: COURSE,
  }
}

export function overview(db: Db, user: SessionUser) {
  assertLearnerAccess(user)
  const outcomes = outcomeView(db)
  const confirmed = outcomes.filter((item) => item.status === "met").length
  const latest = db.versions.at(-1) ?? null
  const published = db.reviews.at(-1) ?? null
  const donePlans = db.plans.filter((item) => item.done).length
  return {
    user,
    ...context(),
    plans: { done: donePlans, total: db.plans.length },
    outcomes: { confirmed, total: outcomes.length, items: outcomes },
    submission: latest
      ? { versionNo: latest.versionNo, receipt: latest.receipt, submittedAt: latest.submittedAt }
      : null,
    reviewPublished: Boolean(published),
    quizCount: db.quizzes.length,
    exploreDone: db.exploreDone,
    familyNotes: db.familyNotes.length,
    waitingReview: Boolean(latest) && !published,
  }
}

export function learnPayload(db: Db, user: SessionUser) {
  assertLearnerAccess(user)
  const latest = db.versions.at(-1) ?? null
  const review = db.reviews.at(-1) ?? null
  const canEdit = user.role === "student"
  return {
    ...context(),
    canEdit,
    exploreDone: db.exploreDone,
    explore: {
      title: "Khám phá: khi nào thì rẽ nhánh?",
      body: [
        "Một chương trình thường cần chọn một trong hai hướng. Trong Python, if kiểm tra một điều kiện. Nếu điều kiện đúng, máy chạy khối lệnh thụt vào bên dưới. Nếu sai, máy chuyển sang else.",
        "Ví dụ điểm số: từ 5 trở lên thì in Đạt, thấp hơn thì in Chưa đạt. Dấu hai chấm kết thúc dòng điều kiện. Các lệnh thuộc nhánh phải thụt vào cùng một mức.",
      ],
    },
    practice: {
      title: "Thực hành: phân loại điểm",
      prompt:
        "Viết chương trình đọc biến diem. Nếu diem >= 5 thì in Đạt, ngược lại in Chưa đạt. Phía dưới, giải thích bạn chọn điều kiện nào và một ví dụ bạn đã tự thử.",
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
    quiz: QUIZ.map(({ id, prompt, choices }) => ({ id, prompt, choices })),
    lastQuiz: db.quizzes.at(-1) ?? null,
  }
}

export function saveDraft(db: Db, user: SessionUser, input: { code: string; reflection: string; version: number }) {
  assertLearnerAccess(user)
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
  assertLearnerAccess(user)
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
  return { receipt: db.idempotency[key], duplicate: false }
}

export function markExplore(db: Db, user: SessionUser) {
  assertLearnerAccess(user)
  if (user.role !== "student") throw new HttpError(403, "Chỉ học sinh ghi nhận được việc đã đọc.")
  db.exploreDone = true
  const plan = db.plans.find((item) => item.id === "plan-read")
  if (plan) plan.done = true
  return { exploreDone: true }
}

export function gradeQuiz(db: Db, user: SessionUser, answers: number[]) {
  assertLearnerAccess(user)
  if (user.role !== "student") throw new HttpError(403, "Chỉ học sinh làm được bài luyện tập này.")
  if (answers.length !== QUIZ.length || answers.some((value) => !Number.isInteger(value) || value < 0 || value > 2)) {
    throw new HttpError(400, "Hãy chọn một đáp án cho mỗi câu.")
  }
  const explanations = QUIZ.map((question, index) => ({
    id: question.id,
    correct: answers[index] === question.answer,
    explain: question.explain,
  }))
  const score = explanations.filter((item) => item.correct).length
  const attempt = {
    id: `quiz-${db.quizzes.length + 1}`,
    answers,
    score,
    total: QUIZ.length,
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
  assertLearnerAccess(user)
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
  return { publishedAt, outcomes: outcomeView(db) }
}

export function recordsPayload(db: Db, user: SessionUser) {
  assertLearnerAccess(user)
  return {
    ...context(),
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
    ...context(),
    learner: LEARNER,
    latest,
    review,
    criteria: CRITERIA.map(({ id, label }) => ({ id, label })),
    outcomes: outcomeView(db),
    roster: [{ name: LEARNER.name, className: LEARNER.className, course: COURSE.name }],
  }
}

