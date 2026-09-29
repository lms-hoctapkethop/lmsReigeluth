import { HttpError, LEARNER, notify, recordAudit, type Db } from "@/lib/db"
import type { AssignmentWork, AuthoredModule, ItemFact, ModuleItem, ModuleRelease, PathRelease } from "@/lib/module-types"

export type { AuthoredModule, ItemFact, ModuleItem, ModuleRelease, PathRelease } from "@/lib/module-types"

const kinds = new Set(["none", "view", "self_mark", "submit"])

export function isRequirement(item: ModuleItem) {
  return item.visible && item.type !== "header" && item.completion.kind !== "none"
}

export function effectiveRequirements(moduleDoc: AuthoredModule) {
  return moduleDoc.items.filter(isRequirement)
}

export function sampleWeekModule(): AuthoredModule {
  return {
    key: "TH10-W1",
    versionKey: "TH10-W1.v1",
    title: "Tuần mẫu",
    summary: "Năm dòng, ba requirement, đi lần lượt.",
    state: "draft",
    policy: { mode: "all", sequential: true },
    items: [
      { key: "h", position: 1, indent: 0, title: "Học và thực hành", visible: true, type: "header", resourceVersionKey: null, completion: { kind: "none" } },
      { key: "p", position: 2, indent: 0, title: "Khám phá", visible: true, type: "page", resourceVersionKey: "page.v1", completion: { kind: "self_mark" } },
      { key: "l", position: 3, indent: 0, title: "Tham khảo", visible: true, type: "link", resourceVersionKey: "link.v1", completion: { kind: "none" } },
      { key: "a", position: 4, indent: 0, title: "Thực hành", visible: true, type: "assignment", resourceVersionKey: "assignment.v1", completion: { kind: "submit" } },
      {
        key: "q",
        position: 5,
        indent: 0,
        title: "Luyện tập",
        visible: true,
        type: "quiz",
        resourceVersionKey: "quiz.v1",
        completion: { kind: "submit" },
        quiz: {
          questions: [
            { key: "Q1", prompt: "else chạy khi nào?", options: ["Khi if đúng", "Khi if sai"], answer: 1 },
            { key: "Q2", prompt: "Điểm luyện tập có xác nhận mục tiêu không?", options: ["Có", "Không"], answer: 1 },
          ],
        },
      },
    ],
  }
}

export function assertModuleShape(moduleDoc: AuthoredModule) {
  if (moduleDoc.policy.sequential && moduleDoc.policy.mode !== "all") {
    throw new HttpError(422, "P1a chỉ cho đi lần lượt khi policy là all.", { code: "SEQUENTIAL_REQUIRES_ALL" })
  }
  for (const item of moduleDoc.items) {
    const kind = (item.completion as { kind?: string }).kind
    if (kind === "min_score") {
      throw new HttpError(422, "min_score chưa bật. P1a không đổi yêu cầu này thành đã nộp.", { code: "FEATURE_NOT_ENABLED" })
    }
    if (!kinds.has(kind ?? "")) throw new HttpError(400, "Loại hoàn thành không thuộc P1a.")
    if (item.type === "header" && (item.resourceVersionKey !== null || item.completion.kind !== "none")) {
      throw new HttpError(400, "Header không có tài nguyên và không có requirement.")
    }
  }
  if ((moduleDoc.policy.mode === "all" || moduleDoc.policy.mode === "one") && effectiveRequirements(moduleDoc).length === 0) {
    throw new HttpError(422, "Policy all hoặc one cần ít nhất một requirement trước khi phát hành.", { code: "EMPTY_REQUIREMENTS" })
  }
}

export function rejectCanvasPrincipal(body: Record<string, unknown>) {
  const principal = body.principal ?? body.actor ?? body.service
  if (principal === "canvas" || body.action === "canvas-import") {
    throw new HttpError(403, "Canvas không được ghi hồ sơ học tập hay hồ sơ KC.", { code: "ATTAINMENT_WRITE_FORBIDDEN" })
  }
}

export function rejectDisabledDelivery(body: Record<string, unknown>, classDeliveryEnabled = false) {
  rejectCanvasPrincipal(body)
  if (body.kcGate != null || body.min_score != null || body.action === "kc-gate") {
    throw new HttpError(422, "Cổng KC và min_score chưa bật ở P1a.", { code: "FEATURE_NOT_ENABLED" })
  }
  if (body.action === "deliver" && classDeliveryEnabled !== true) {
    throw new HttpError(403, "Giao lớp chưa được bật trên dữ liệu trường.", { code: "CLASS_DELIVERY_OFF" })
  }
}

function clipText(value: string, max: number) {
  return value.replace(/\r\n/g, "\n").trim().slice(0, max)
}

export function createLesson(db: Db, title: string) {
  const name = clipText(title, 160).replace(/\s+/g, " ")
  if (name.length < 3) throw new HttpError(400, "Tên bài cần ít nhất 3 ký tự.")
  const key = `TH10-GV-${Date.now().toString(36)}`
  const moduleDoc: AuthoredModule = {
    key,
    versionKey: `${key}.v1`,
    title: name,
    summary: "Bài giáo viên soạn. Học sinh chỉ thấy sau khi giao.",
    state: "draft",
    policy: { mode: "all", sequential: true },
    items: [
      { key: "h", position: 1, indent: 0, title: "Bài học và bài tập", visible: true, type: "header", resourceVersionKey: null, completion: { kind: "none" } },
      { key: "p", position: 2, indent: 1, title: "Bài học", visible: true, type: "page", resourceVersionKey: null, completion: { kind: "self_mark" }, body: "" },
      { key: "a", position: 3, indent: 1, title: "Bài tập", visible: true, type: "assignment", resourceVersionKey: null, completion: { kind: "submit" }, prompt: "", dueAt: null },
    ],
  }
  const saved = saveAuthoredModule(db, moduleDoc)
  recordAudit(db, { actorId: "teacher-ha", actorName: "Nguyễn Hà", action: "Tạo bài soạn", target: name })
  return { key: saved.module.key, module: saved.module }
}

export function saveLessonDraft(
  db: Db,
  input: { key: string; title: string; pageBody: string; assignmentPrompt: string; linkHref?: string; dueAt?: string | null },
) {
  const current = db.authoredModules.find((item) => item.key === input.key)
  if (!current) throw new HttpError(404, "Không thấy bản soạn.")
  const next = structuredClone(current)
  next.title = clipText(input.title, 160).replace(/\s+/g, " ")
  if (next.title.length < 3) throw new HttpError(400, "Tên bài cần ít nhất 3 ký tự.")
  const page = next.items.find((item) => item.type === "page")
  const assignment = next.items.find((item) => item.type === "assignment")
  if (!page || !assignment) throw new HttpError(400, "Bản soạn cần một trang bài học và một bài tập.")
  page.body = clipText(input.pageBody, 20000)
  assignment.prompt = clipText(input.assignmentPrompt, 8000)
  const dueAt = (input.dueAt ?? "").trim()
  if (dueAt && !/^\d{4}-\d{2}-\d{2}$/.test(dueAt)) throw new HttpError(400, "Hạn nộp cần là một ngày.")
  assignment.dueAt = dueAt || null
  const link = next.items.find((item) => item.type === "link")
  if (link && input.linkHref) link.href = clipText(input.linkHref, 500)
  const saved = saveAuthoredModule(db, next)
  return saved
}

export function deliverModule(db: Db, moduleKey: string) {
  if (!db.classDeliveryEnabled) {
    throw new HttpError(403, "Giao lớp chưa được bật trên dữ liệu trường.", { code: "CLASS_DELIVERY_OFF" })
  }
  const weekLabel = db.org.weekLabel
  const lessonTitle = db.module.title
  const source = db.authoredModules.find((item) => item.key === moduleKey)
  if (!source) throw new HttpError(422, "Không thấy module để giao.", { code: "MODULE_NOT_FOUND" })
  assertModuleShape(source)
  const page = source.items.find((item) => item.type === "page")
  const assignment = source.items.find((item) => item.type === "assignment")
  if (!page?.body || page.body.trim().length < 12) {
    throw new HttpError(400, "Hãy viết nội dung bài học, lưu bản soạn, rồi mới giao.")
  }
  if (!assignment?.prompt || assignment.prompt.trim().length < 12) {
    throw new HttpError(400, "Hãy viết đề bài tập, lưu bản soạn, rồi mới giao.")
  }
  const snapshot = structuredClone(source)
  snapshot.state = "published"
  const releaseKey = `rel-${source.key}`
  const publishedAt = new Date().toISOString()
  const release: ModuleRelease = {
    releaseKey,
    moduleVersionKey: source.versionKey,
    position: 1,
    availableFrom: new Date(Date.now() - 60_000).toISOString(),
    dueAt: assignment.dueAt ?? null,
    prerequisiteReleaseKeys: [],
    snapshot,
  }
  if (!db.pathRelease) {
    db.pathRelease = {
      pathReleaseKey: "path-10a1",
      offeringId: "offering-10a1",
      publishedAt,
      modules: [release],
    }
  } else {
    const index = db.pathRelease.modules.findIndex((item) => item.snapshot.key === source.key)
    if (index >= 0) {
      release.position = db.pathRelease.modules[index].position
      db.pathRelease.modules[index] = release
    } else {
      release.position = db.pathRelease.modules.length + 1
      db.pathRelease.modules.push(release)
    }
    db.pathRelease.publishedAt = publishedAt
  }
  if (db.org.weekLabel !== weekLabel || db.module.title !== lessonTitle) {
    throw new HttpError(500, "Giao bài không được đổi tuần lớp hoặc bài đang học.")
  }
  notify(db, {
    userId: LEARNER.id,
    title: "Có bài mới được giao",
    summary: source.title,
    href: "/classwork",
  })
  recordAudit(db, { actorId: "teacher-ha", actorName: "Nguyễn Hà", action: "Giao bài cho lớp", target: source.title })
  return {
    receipt: `PATH-${publishedAt.slice(0, 10).replaceAll("-", "")}-${releaseKey}`,
    pathReleaseKey: db.pathRelease.pathReleaseKey,
    releaseKey,
    title: source.title,
  }
}

export function unpublishModule(db: Db, moduleKey: string) {
  const weekLabel = db.org.weekLabel
  const lessonTitle = db.module.title
  const current = db.pathRelease
  if (!current) return { removed: false }
  const kept = current.modules.filter((item) => item.snapshot.key !== moduleKey)
  const removed = kept.length !== current.modules.length
  if (!removed) return { removed: false }
  if (kept.length === 0) db.pathRelease = null
  else db.pathRelease = { ...current, modules: kept.map((item, index) => ({ ...item, position: index + 1 })) }
  if (db.org.weekLabel !== weekLabel || db.module.title !== lessonTitle) {
    throw new HttpError(500, "Thu bài không được đổi tuần lớp hoặc bài đang học.")
  }
  const title = current.modules.find((item) => item.snapshot.key === moduleKey)?.snapshot.title ?? moduleKey
  recordAudit(db, { actorId: "teacher-ha", actorName: "Nguyễn Hà", action: "Thu bài khỏi lớp", target: title })
  return { removed: true, title }
}

export function saveAuthoredModule(db: Db, moduleDoc: AuthoredModule) {
  assertModuleShape(moduleDoc)
  const next: AuthoredModule = structuredClone(moduleDoc)
  next.state = "draft"
  const index = db.authoredModules.findIndex((item) => item.key === next.key)
  if (index >= 0) db.authoredModules[index] = next
  else db.authoredModules.push(next)
  return { module: next, requirementCount: effectiveRequirements(next).length }
}

export function deliverPath(
  db: Db,
  input: {
    pathReleaseKey: string
    modules: {
      releaseKey: string
      moduleKey: string
      availableFrom: string
      dueAt: string | null
      prerequisiteReleaseKeys: string[]
      kcGate?: unknown
    }[]
  },
) {
  if (!db.classDeliveryEnabled) {
    throw new HttpError(403, "Giao lớp chưa được bật trên dữ liệu trường.", { code: "CLASS_DELIVERY_OFF" })
  }
  if (input.modules.some((item) => item.kcGate != null)) {
    throw new HttpError(422, "Cổng KC chưa bật ở P1a.", { code: "FEATURE_NOT_ENABLED" })
  }
  const releases: ModuleRelease[] = input.modules.map((item, index) => {
    const source = db.authoredModules.find((moduleDoc) => moduleDoc.key === item.moduleKey)
    if (!source) throw new HttpError(422, "Không thấy module để giao.", { code: "MODULE_NOT_FOUND" })
    assertModuleShape(source)
    if (source.policy.mode === "none" && input.modules.some((other) => other.prerequisiteReleaseKeys.includes(item.releaseKey))) {
      throw new HttpError(422, "Module không có requirement không được làm tiên quyết.", { code: "NONE_PREREQUISITE" })
    }
    const snapshot = structuredClone(source)
    snapshot.state = "published"
    return {
      releaseKey: item.releaseKey,
      moduleVersionKey: source.versionKey,
      position: index + 1,
      availableFrom: item.availableFrom,
      dueAt: item.dueAt,
      prerequisiteReleaseKeys: [...item.prerequisiteReleaseKeys],
      snapshot,
    }
  })
  assertDag(releases)
  const publishedAt = new Date().toISOString()
  const pathRelease: PathRelease = {
    pathReleaseKey: input.pathReleaseKey,
    offeringId: "offering-10a1",
    publishedAt,
    modules: releases,
  }
  db.pathRelease = pathRelease
  return {
    receipt: `PATH-${publishedAt.slice(0, 10).replaceAll("-", "")}-${input.pathReleaseKey}`,
    pathReleaseKey: pathRelease.pathReleaseKey,
    releaseKeys: releases.map((item) => item.releaseKey),
  }
}

function assertDag(releases: ModuleRelease[]) {
  const position = new Map(releases.map((item) => [item.releaseKey, item.position]))
  for (const release of releases) {
    for (const prerequisite of release.prerequisiteReleaseKeys) {
      if (prerequisite === release.releaseKey) throw new HttpError(422, "Tiên quyết không được trỏ vào chính module.", { code: "DAG" })
      const earlier = position.get(prerequisite)
      if (earlier === undefined || earlier >= release.position) {
        throw new HttpError(422, "Tiên quyết phải là module đứng trước trong cùng đợt giao.", { code: "DAG" })
      }
    }
  }
}

export function modulesPayload(db: Db, role: "student" | "teacher" | "guardian" | "admin") {
  const pathRelease = db.pathRelease
    ? {
        ...db.pathRelease,
        modules: db.pathRelease.modules.map((release) => ({
          ...release,
          snapshot: role === "teacher" ? release.snapshot : stripAnswers(release.snapshot),
          lock: lockReasons(db, release, LEARNER.id, new Date().toISOString()),
        })),
      }
    : null
  return {
    revision: db.revision,
    weekLabel: db.org.weekLabel,
    classDeliveryEnabled: db.classDeliveryEnabled,
    requirementNote: "Header và mục không có requirement không tính vào mẫu số.",
    drafts: role === "teacher" ? db.authoredModules : [],
    pathRelease,
    facts: db.itemFacts.filter((fact) => fact.learnerId === LEARNER.id),
    assignmentWork: db.assignmentWork.filter((item) => role === "teacher" || item.learnerId === LEARNER.id),
  }
}

function stripAnswers(moduleDoc: AuthoredModule): AuthoredModule {
  const copy = structuredClone(moduleDoc)
  for (const item of copy.items) {
    if (!item.quiz) continue
    item.quiz = {
      questions: item.quiz.questions.map(({ key, prompt, options }) => ({ key, prompt, options, answer: -1 })),
    }
  }
  return copy
}

function completedKeys(db: Db, releaseKey: string, learnerId: string) {
  return new Set(db.itemFacts.filter((fact) => fact.moduleReleaseKey === releaseKey && fact.learnerId === learnerId).map((fact) => fact.itemKey))
}

function moduleComplete(db: Db, release: ModuleRelease, learnerId: string) {
  const done = completedKeys(db, release.releaseKey, learnerId)
  return effectiveRequirements(release.snapshot).every((item) => done.has(item.key))
}

export function lockReasons(db: Db, release: ModuleRelease, learnerId: string, now: string) {
  const reasons: string[] = []
  if (learnerId !== LEARNER.id) reasons.push("scope")
  if (now < release.availableFrom) reasons.push("schedule")
  const path = db.pathRelease
  if (path) {
    for (const prerequisite of release.prerequisiteReleaseKeys) {
      const earlier = path.modules.find((item) => item.releaseKey === prerequisite)
      if (!earlier || !moduleComplete(db, earlier, learnerId)) reasons.push("prerequisite")
    }
  }
  return reasons
}

function assertOpen(db: Db, release: ModuleRelease, item: ModuleItem, learnerId: string, now: string) {
  if (learnerId !== LEARNER.id) throw new HttpError(403, "Bạn không ở đúng lớp học phần.", { code: "SCOPE_MISMATCH" })
  const reasons = lockReasons(db, release, learnerId, now)
  if (reasons.includes("schedule")) throw new HttpError(403, "Mục này chưa tới ngày mở.", { code: "SCHEDULE_LOCKED" })
  if (reasons.includes("prerequisite")) throw new HttpError(403, "Module tiên quyết chưa hoàn thành.", { code: "PREREQUISITE_LOCKED" })
  if (release.snapshot.policy.sequential) {
    const done = completedKeys(db, release.releaseKey, learnerId)
    const unmet = release.snapshot.items.filter((candidate) => candidate.position < item.position && isRequirement(candidate) && !done.has(candidate.key))
    if (unmet.length > 0) throw new HttpError(403, "Còn requirement đứng trước chưa xong.", { code: "SEQUENTIAL_LOCKED" })
  }
}

function findRelease(db: Db, releaseKey: string) {
  const release = db.pathRelease?.modules.find((item) => item.releaseKey === releaseKey)
  if (!release) throw new HttpError(404, "Không thấy lần giao này.")
  return release
}

export function markItem(
  db: Db,
  input: { learnerId: string; releaseKey: string; itemKey: string; now?: string },
) {
  const release = findRelease(db, input.releaseKey)
  const item = release.snapshot.items.find((candidate) => candidate.key === input.itemKey)
  if (!item) throw new HttpError(404, "Không thấy mục này.")
  if (item.completion.kind !== "self_mark") throw new HttpError(400, "Mục này không dùng nút tự đánh dấu.")
  assertOpen(db, release, item, input.learnerId, input.now ?? new Date().toISOString())
  if (db.itemFacts.some((fact) => fact.moduleReleaseKey === release.releaseKey && fact.itemKey === item.key && fact.learnerId === input.learnerId)) {
    return { completed: true, duplicate: true }
  }
  const fact: ItemFact = {
    learnerId: input.learnerId,
    moduleReleaseKey: release.releaseKey,
    itemKey: item.key,
    completedAt: input.now ?? new Date().toISOString(),
    reason: "self_mark",
  }
  db.itemFacts.push(fact)
  return { completed: true, duplicate: false, fact }
}

export function submitAssignment(
  db: Db,
  input: { learnerId: string; releaseKey: string; itemKey: string; now?: string; text?: string },
) {
  const before = db.decisions.length
  const release = findRelease(db, input.releaseKey)
  const item = release.snapshot.items.find((candidate) => candidate.key === input.itemKey)
  if (!item || item.type !== "assignment") throw new HttpError(404, "Không thấy bài nộp này.")
  if (item.completion.kind !== "submit") throw new HttpError(400, "Bài này không hoàn thành bằng lần nộp.")
  assertOpen(db, release, item, input.learnerId, input.now ?? new Date().toISOString())
  const text = input.text === undefined ? undefined : clipText(input.text, 4000)
  if (text !== undefined && text.length < 12) throw new HttpError(400, "Bài làm cần một đoạn đủ để giáo viên đọc.")
  const submittedAt = input.now ?? new Date().toISOString()
  if (text !== undefined) {
    const work: AssignmentWork = {
      id: `work-${db.assignmentWork.length + 1}`,
      learnerId: input.learnerId,
      moduleReleaseKey: release.releaseKey,
      itemKey: item.key,
      text,
      submittedAt,
    }
    db.assignmentWork.push(work)
  }
  if (!db.itemFacts.some((fact) => fact.moduleReleaseKey === release.releaseKey && fact.itemKey === item.key && fact.learnerId === input.learnerId)) {
    db.itemFacts.push({
      learnerId: input.learnerId,
      moduleReleaseKey: release.releaseKey,
      itemKey: item.key,
      completedAt: submittedAt,
      reason: "submit",
    })
  }
  if (db.decisions.length !== before) throw new HttpError(500, "Bài nộp đã chạm hồ sơ KC.")
  return { completed: true, decisionsUnchanged: true }
}

export function submitModuleQuiz(
  db: Db,
  input: { learnerId: string; releaseKey: string; itemKey: string; answers: number[]; now?: string },
) {
  const before = db.decisions.length
  const release = findRelease(db, input.releaseKey)
  const item = release.snapshot.items.find((candidate) => candidate.key === input.itemKey)
  if (!item?.quiz) throw new HttpError(404, "Không thấy quiz của mục này.")
  if (item.completion.kind !== "submit") throw new HttpError(400, "Quiz này không hoàn thành bằng lần nộp.")
  assertOpen(db, release, item, input.learnerId, input.now ?? new Date().toISOString())
  const questions = item.quiz.questions
  if (input.answers.length !== questions.length || input.answers.some((value, index) => !Number.isInteger(value) || value < 0 || value >= questions[index].options.length)) {
    throw new HttpError(400, "Hãy chọn một đáp án cho mỗi câu.")
  }
  const score = questions.filter((question, index) => input.answers[index] === question.answer).length
  const submittedAt = input.now ?? new Date().toISOString()
  db.moduleQuizAttempts.push({
    id: `mq-${db.moduleQuizAttempts.length + 1}`,
    learnerId: input.learnerId,
    moduleReleaseKey: release.releaseKey,
    itemKey: item.key,
    answers: input.answers,
    score,
    total: questions.length,
    submittedAt,
  })
  if (!db.itemFacts.some((fact) => fact.moduleReleaseKey === release.releaseKey && fact.itemKey === item.key && fact.learnerId === input.learnerId)) {
    db.itemFacts.push({
      learnerId: input.learnerId,
      moduleReleaseKey: release.releaseKey,
      itemKey: item.key,
      completedAt: submittedAt,
      reason: "submit",
    })
  }
  if (db.decisions.length !== before) throw new HttpError(500, "Quiz đã chạm hồ sơ KC.")
  return { score, total: questions.length, completed: true, decisionsUnchanged: true }
}

export function rejectAttainmentWrite(body: Record<string, unknown>) {
  if ("decision" in body || "attainment" in body || "outcomeId" in body || body.recordAttainment === true) {
    throw new HttpError(422, "Tiến độ và quiz không được ghi hồ sơ KC.", { code: "ATTAINMENT_WRITE_FORBIDDEN" })
  }
}
