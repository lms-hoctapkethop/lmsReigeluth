import { HttpError, notify, recordAudit, type Db, type ModuleDoc, type QuizItem } from "@/lib/db"
import type { SessionUser } from "@/lib/session"

function requireTeacher(user: SessionUser) {
  if (user.role !== "teacher" || user.id !== "teacher-ha") {
    throw new HttpError(403, "Chỉ giáo viên được phân công mới soạn nội dung khóa học.")
  }
}

export function contentPayload(db: Db, user: SessionUser) {
  requireTeacher(user)
  return {
    published: db.module,
    draft: db.moduleDraft,
  }
}

export function saveModuleDraft(db: Db, user: SessionUser, input: ModuleDoc) {
  requireTeacher(user)
  db.moduleDraft = sanitizeModule(input, "draft", db.moduleDraft.version)
  recordAudit(db, { actorId: user.id, actorName: user.name, action: "Lưu bản nháp nội dung", target: db.moduleDraft.title })
  return { draft: db.moduleDraft }
}

export function publishModule(db: Db, user: SessionUser) {
  requireTeacher(user)
  const next = sanitizeModule(db.moduleDraft, "published", db.module.version + 1)
  next.updatedAt = new Date().toISOString()
  db.module = next
  db.moduleDraft = { ...next, status: "draft" }
  notify(db, {
    userId: "learner-an",
    title: "Nội dung bài học đã được phát hành",
    summary: `Phiên bản ${next.version}: ${next.title}.`,
    href: "/learn",
  })
  recordAudit(db, {
    actorId: user.id,
    actorName: user.name,
    action: "Phát hành nội dung",
    target: `Phiên bản ${next.version}`,
  })
  return { published: db.module }
}

function sanitizeModule(input: ModuleDoc, status: ModuleDoc["status"], version: number): ModuleDoc {
  const title = oneLine(input.title, 120)
  const summary = oneLine(input.summary, 400)
  const exploreTitle = oneLine(input.exploreTitle, 120)
  const practiceTitle = oneLine(input.practiceTitle, 120)
  const practicePrompt = keepText(input.practicePrompt, 2000)
  const exploreBody = (input.exploreBody ?? []).map((item) => keepText(item, 2000)).filter(Boolean)
  if (title.length < 3 || exploreTitle.length < 3 || practiceTitle.length < 3 || practicePrompt.length < 12 || exploreBody.length === 0) {
    throw new HttpError(400, "Cần đủ tên bài, phần khám phá và đề thực hành.")
  }
  const quiz = (input.quiz ?? []).slice(0, 6).map(sanitizeQuestion)
  if (quiz.length < 1) throw new HttpError(400, "Bài luyện tập cần ít nhất một câu.")
  return {
    title,
    summary,
    exploreTitle,
    exploreBody,
    practiceTitle,
    practicePrompt,
    quiz,
    status,
    version,
    updatedAt: new Date().toISOString(),
  }
}

function sanitizeQuestion(input: QuizItem, index: number): QuizItem {
  const prompt = keepText(input.prompt, 500)
  const choices = (input.choices ?? []).map((item) => keepText(item, 300)).filter(Boolean).slice(0, 6)
  const explain = keepText(input.explain, 500)
  const answer = Number(input.answer)
  if (prompt.length < 3 || choices.length < 2 || !Number.isInteger(answer) || answer < 0 || answer >= choices.length || explain.length < 3) {
    throw new HttpError(400, `Câu ${index + 1} cần đề bài, ít nhất hai lựa chọn, đáp án đúng và lời giải thích.`)
  }
  return {
    id: oneLine(input.id, 40) || `q${index + 1}`,
    prompt,
    choices,
    answer,
    explain,
  }
}

function oneLine(value: string | undefined, max: number) {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, max)
}

function keepText(value: string | undefined, max: number) {
  return (value ?? "").replace(/\r\n/g, "\n").trim().slice(0, max)
}
