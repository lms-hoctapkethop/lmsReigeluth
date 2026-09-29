import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto"
import { DEMO_ACCOUNTS } from "@/lib/accounts"
import type { AuthoredModule, ItemFact, ModuleQuizAttempt, PathRelease } from "@/lib/module-types"
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, writeSync } from "fs"
import path from "path"

export type Role = "student" | "teacher" | "guardian" | "admin"

export type User = {
  id: string
  email: string
  name: string
  role: Role
  passwordSalt: string
  passwordHash: string
}

export type PlanItem = {
  id: string
  learnerId: string
  title: string
  due: string
  source: "assigned" | "personal"
  done: boolean
}

export type Draft = {
  learnerId: string
  code: string
  reflection: string
  version: number
  updatedAt: string | null
}

export type SubmissionVersion = {
  versionNo: number
  code: string
  reflection: string
  submittedAt: string
  receipt: string
}

export type Review = {
  id: string
  versionNo: number
  reviewerId: string
  criteria: { id: string; label: string; met: boolean; note: string }[]
  publishedAt: string
}

export type Decision = {
  id: string
  outcomeId: string
  decision: "met" | "not_met"
  reason: string
  decidedBy: string
  decidedAt: string
  supersedesId?: string
}

export type QuizAttempt = {
  id: string
  answers: number[]
  score: number
  total: number
  submittedAt: string
  explanations: { id: string; correct: boolean; explain: string }[]
}

export type FamilyNote = {
  id: string
  guardianId: string
  note: string
  confirmedAt: string
}

export type QuizItem = {
  id: string
  prompt: string
  choices: string[]
  answer: number
  explain: string
}

export type ModuleDoc = {
  title: string
  summary: string
  exploreTitle: string
  exploreBody: string[]
  practiceTitle: string
  practicePrompt: string
  quiz: QuizItem[]
  status: "draft" | "published"
  version: number
  updatedAt: string | null
}

export type OrgProfile = {
  school: string
  className: string
  courseTitle: string
  offeringTitle: string
  weekLabel: string
}

export type GuardianLink = {
  id: string
  guardianId: string
  learnerId: string
  status: "pending" | "active" | "revoked"
  verifiedAt: string | null
  reason: string
}

export type AppNotification = {
  id: string
  userId: string
  title: string
  summary: string
  href: string
  createdAt: string
  readAt: string | null
}

export type AuditEvent = {
  id: string
  at: string
  actorId: string
  actorName: string
  action: string
  target: string
}

export type CommandReceipt = {
  fingerprint: string
  revision: number
  receipt: string
  result: unknown
}

export type Db = {
  revision: number
  receipts: Record<string, CommandReceipt>
  users: User[]
  plans: PlanItem[]
  exploreDone: boolean
  draft: Draft
  versions: SubmissionVersion[]
  reviews: Review[]
  decisions: Decision[]
  quizzes: QuizAttempt[]
  familyNotes: FamilyNote[]
  idempotency: Record<string, { receipt: string; versionNo: number; submittedAt: string }>
  module: ModuleDoc
  moduleDraft: ModuleDoc
  org: OrgProfile
  guardianLink: GuardianLink
  notifications: AppNotification[]
  audit: AuditEvent[]
  authoredModules: AuthoredModule[]
  pathRelease: PathRelease | null
  classDeliveryEnabled: boolean
  itemFacts: ItemFact[]
  moduleQuizAttempts: ModuleQuizAttempt[]
}

const file = path.join(process.cwd(), "data", "db.json")

export const LEARNER = {
  id: "learner-an",
  name: "Lê An",
  className: "10A1",
}

export const COURSE = {
  name: "Tin học 10",
  module: "Bài 03 · Rẽ nhánh if–else",
  week: "28/09 – 04/10/2026",
}

export const OUTCOMES = [
  { id: "syntax", title: "Viết điều kiện if–else đúng cú pháp Python" },
  { id: "branch", title: "Phân biệt nhánh đúng và nhánh sai" },
  { id: "explain", title: "Giải thích vì sao chọn nhánh đó" },
  { id: "check", title: "Tự kiểm tra bằng một ví dụ cụ thể" },
  { id: "quiz", title: "Hoàn thành bài luyện tập trắc nghiệm" },
] as const

export const CRITERIA = [
  { id: "syntax", label: "Cú pháp if–else", outcomes: ["syntax", "branch"] },
  { id: "explain", label: "Giải thích lựa chọn", outcomes: ["explain"] },
  { id: "check", label: "Ví dụ tự kiểm tra", outcomes: ["check"] },
] as const

export const QUIZ: QuizItem[] = [
  {
    id: "q1",
    prompt: "Đoạn nào in Đạt khi điểm từ 5 trở lên?",
    choices: [
      'if diem >= 5:\n    print("Đạt")',
      'if diem >= 5 print("Đạt")',
      'if (diem >= 5) { print("Đạt") }',
    ],
    answer: 0,
    explain: "Python dùng dấu hai chấm và thụt dòng để mở khối lệnh, không dùng ngoặc nhọn.",
  },
  {
    id: "q2",
    prompt: "Khối else được chạy khi nào?",
    choices: ["Khi điều kiện if đúng", "Khi điều kiện if sai", "Luôn chạy sau if"],
    answer: 1,
    explain: "else là nhánh còn lại: chỉ chạy khi điều kiện của if không thỏa.",
  },
  {
    id: "q3",
    prompt: "Vì sao lệnh bên trong if phải thụt vào?",
    choices: [
      "Python dùng thụt dòng để biết lệnh nào thuộc khối",
      "Chỉ để bài trông đẹp hơn",
      "Máy tính bỏ qua mọi khoảng trắng",
    ],
    answer: 0,
    explain: "Thụt dòng là cú pháp. Lệnh cùng mức thụt thuộc cùng một khối.",
  },
]

export function defaultModule(status: ModuleDoc["status"] = "published"): ModuleDoc {
  return {
    title: "Bài 03 · Rẽ nhánh if–else",
    summary: "Chọn một trong hai hướng bằng if–else, rồi giải thích vì sao chọn nhánh đó.",
    exploreTitle: "Khám phá: khi nào thì rẽ nhánh?",
    exploreBody: [
      "Một chương trình thường cần chọn một trong hai hướng. Trong Python, if kiểm tra một điều kiện. Nếu điều kiện đúng, máy chạy khối lệnh thụt vào bên dưới. Nếu sai, máy chuyển sang else.",
      "Ví dụ điểm số: từ 5 trở lên thì in Đạt, thấp hơn thì in Chưa đạt. Dấu hai chấm kết thúc dòng điều kiện. Các lệnh thuộc nhánh phải thụt vào cùng một mức.",
    ],
    practiceTitle: "Thực hành: phân loại điểm",
    practicePrompt:
      "Viết chương trình đọc biến diem. Nếu diem >= 5 thì in Đạt, ngược lại in Chưa đạt. Phía dưới, giải thích bạn chọn điều kiện nào và một ví dụ bạn đã tự thử.",
    quiz: QUIZ.map((item) => ({ ...item, choices: [...item.choices] })),
    status,
    version: 1,
    updatedAt: null,
  }
}

export function defaultOrg(): OrgProfile {
  return {
    school: "Một trường",
    className: "10A1",
    courseTitle: "Tin học 10",
    offeringTitle: "Tin học 10 · 10A1",
    weekLabel: "28/09 – 04/10/2026",
  }
}

export function defaultLink(): GuardianLink {
  return {
    id: "link-mai-an",
    guardianId: "guardian-mai",
    learnerId: LEARNER.id,
    status: "active",
    verifiedAt: "2026-09-28T00:00:00.000Z",
    reason: "Nhà trường đã xác minh phụ huynh của Lê An.",
  }
}

function accountId(role: Role) {
  if (role === "student") return LEARNER.id
  if (role === "teacher") return "teacher-ha"
  if (role === "guardian") return "guardian-mai"
  return "admin-school"
}

function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex")
  const passwordHash = scryptSync(password, salt, 32).toString("hex")
  return { passwordSalt: salt, passwordHash }
}

export function verifyPassword(password: string, salt: string, hash: string) {
  const got = scryptSync(password, salt, 32)
  const expected = Buffer.from(hash, "hex")
  return got.length === expected.length && timingSafeEqual(got, expected)
}

function seed(): Db {
  const users: User[] = DEMO_ACCOUNTS.map((account) => ({
    id: accountId(account.role),
    email: account.email,
    name: account.name,
    role: account.role,
    ...hashPassword(account.password),
  }))
  return {
    revision: 0,
    receipts: {},
    users,
    plans: [
      {
        id: "plan-read",
        learnerId: LEARNER.id,
        title: "Đọc phần khám phá về if–else",
        due: "2026-09-29",
        source: "assigned",
        done: false,
      },
      {
        id: "plan-practice",
        learnerId: LEARNER.id,
        title: "Làm bài thực hành rẽ nhánh",
        due: "2026-10-01",
        source: "assigned",
        done: false,
      },
      {
        id: "plan-quiz",
        learnerId: LEARNER.id,
        title: "Làm ba câu trắc nghiệm luyện tập",
        due: "2026-10-02",
        source: "assigned",
        done: false,
      },
      {
        id: "plan-record",
        learnerId: LEARNER.id,
        title: "Xem hồ sơ mục tiêu sau khi nộp bài",
        due: "2026-10-03",
        source: "assigned",
        done: false,
      },
    ],
    exploreDone: false,
    draft: {
      learnerId: LEARNER.id,
      code: "diem = 7\n",
      reflection: "",
      version: 1,
      updatedAt: null,
    },
    versions: [],
    reviews: [],
    decisions: [],
    quizzes: [],
    familyNotes: [],
    idempotency: {},
    module: defaultModule("published"),
    moduleDraft: defaultModule("draft"),
    authoredModules: [],
    pathRelease: null,
    classDeliveryEnabled: false,
    itemFacts: [],
    moduleQuizAttempts: [],
    org: defaultOrg(),
    guardianLink: defaultLink(),
    notifications: [],
    audit: [],
  }
}

export function notify(
  db: Db,
  input: { userId: string; title: string; summary: string; href: string },
) {
  db.notifications.unshift({
    id: `ntf-${db.notifications.length + 1}-${Date.now().toString(36)}`,
    userId: input.userId,
    title: input.title,
    summary: input.summary.slice(0, 180),
    href: input.href,
    createdAt: new Date().toISOString(),
    readAt: null,
  })
}

export function recordAudit(db: Db, input: { actorId: string; actorName: string; action: string; target: string }) {
  db.audit.unshift({
    id: `aud-${db.audit.length + 1}`,
    at: new Date().toISOString(),
    actorId: input.actorId,
    actorName: input.actorName,
    action: input.action,
    target: input.target.slice(0, 160),
  })
}

let chain: Promise<unknown> = Promise.resolve()
let lockHeldByThisProcess = false

function dbFile() {
  return process.env.HCN_DB_PATH || file
}

function lockPath() {
  return process.env.HCN_LOCK_PATH || path.join(path.dirname(dbFile()), "writer.lock")
}

function hydrate(parsed: Partial<Db>): Db {
  const users = parsed.users ?? []
  if (!users.some((item) => item.role === "admin")) {
    const account = DEMO_ACCOUNTS.find((item) => item.role === "admin")
    if (account) {
      users.push({
        id: accountId(account.role),
        email: account.email,
        name: account.name,
        role: account.role,
        ...hashPassword(account.password),
      })
    }
  }
  const receipts = { ...(parsed.receipts ?? {}) }
  const versions = parsed.versions ?? []
  for (const [key, value] of Object.entries(parsed.idempotency ?? {})) {
    if (receipts[key]) continue
    const version = versions.find((item) => item.receipt === value.receipt)
    receipts[key] = {
      fingerprint: version ? commandFingerprint({ code: version.code, reflection: version.reflection }) : `legacy:${value.receipt}`,
      revision: parsed.revision ?? 0,
      receipt: value.receipt,
      result: { receipt: value, duplicate: true },
    }
  }
  return {
    revision: parsed.revision ?? 0,
    receipts,
    users,
    plans: parsed.plans ?? [],
    exploreDone: parsed.exploreDone ?? false,
    draft: parsed.draft ?? seed().draft,
    versions,
    reviews: parsed.reviews ?? [],
    decisions: parsed.decisions ?? [],
    quizzes: parsed.quizzes ?? [],
    familyNotes: parsed.familyNotes ?? [],
    idempotency: parsed.idempotency ?? {},
    module: parsed.module ?? defaultModule("published"),
    moduleDraft: parsed.moduleDraft ?? defaultModule("draft"),
    authoredModules: parsed.authoredModules ?? [],
    pathRelease: parsed.pathRelease ?? null,
    classDeliveryEnabled: parsed.classDeliveryEnabled === true,
    itemFacts: parsed.itemFacts ?? [],
    moduleQuizAttempts: parsed.moduleQuizAttempts ?? [],
    org: parsed.org ?? defaultOrg(),
    guardianLink: parsed.guardianLink ?? defaultLink(),
    notifications: parsed.notifications ?? [],
    audit: parsed.audit ?? [],
  }
}

function read(): Db {
  try {
    return hydrate(JSON.parse(readFileSync(dbFile(), "utf8")) as Partial<Db>)
  } catch {
    return seed()
  }
}

function writeAtomic(db: Db) {
  const target = dbFile()
  mkdirSync(path.dirname(target), { recursive: true })
  const temporary = `${target}.${process.pid}.tmp`
  writeFileSync(temporary, JSON.stringify(db, null, 2))
  renameSync(temporary, target)
}

function ensureWriter() {
  if (lockHeldByThisProcess) return
  const lock = lockPath()
  mkdirSync(path.dirname(lock), { recursive: true })
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(lock, "wx")
      writeSync(fd, String(process.pid))
      closeSync(fd)
      lockHeldByThisProcess = true
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      const holder = Number(readFileSync(lock, "utf8"))
      if (holder === process.pid) {
        lockHeldByThisProcess = true
        return
      }
      if (Number.isInteger(holder) && holder > 0 && existsSync(`/proc/${holder}`)) {
        throw new HttpError(
          503,
          "Đang có một tiến trình khác ghi dữ liệu. Khi khóa còn nằm trong bộ nhớ, app chỉ cho một writer.",
          { code: "SINGLE_WRITER" },
        )
      }
      unlinkSync(lock)
    }
  }
  throw new HttpError(503, "Không giữ được khóa ghi.", { code: "SINGLE_WRITER" })
}

function exclusive<T>(fn: () => T): Promise<T> {
  const run = chain.then(() => {
    ensureWriter()
    return fn()
  })
  chain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

process.on("exit", () => {
  if (!lockHeldByThisProcess) return
  try {
    unlinkSync(lockPath())
  } catch {
    // The next process reclaims a stale lock when this pid is gone.
  }
})

export function withDb<T>(fn: (db: Db) => T): Promise<T> {
  return exclusive(() => fn(read()))
}

export function requireExpectedRevision(value: unknown) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new HttpError(400, "Thiếu revision của bản dữ liệu. Hãy tải lại trang.")
  }
  return value
}

export function commandFingerprint(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex")
}

export function commitWrite<T>(command: {
  expectedRevision: number
  idempotencyKey?: string
  fingerprint?: string
  apply: (db: Db) => T
}): Promise<{ result: T; revision: number; duplicate: boolean }> {
  return exclusive(() => {
    const db = read()
    if (command.idempotencyKey) {
      if (!command.fingerprint) throw new HttpError(400, "Thiếu dấu nội dung của lệnh ghi.")
      const existing = db.receipts[command.idempotencyKey]
      if (existing) {
        if (existing.fingerprint !== command.fingerprint) {
          throw new HttpError(422, "Mã gửi lại này đã dùng cho một nội dung khác.", { code: "IDEMPOTENCY_MISMATCH" })
        }
        const stored = existing.result
        const result =
          stored && typeof stored === "object" ? ({ ...stored, duplicate: true } as T) : (stored as T)
        return { result, revision: db.revision, duplicate: true }
      }
    }
    if (db.revision !== command.expectedRevision) {
      throw new HttpError(409, "Bản dữ liệu đã đổi. Hãy tải lại rồi thử lại.", {
        code: "REVISION_CONFLICT",
        revision: db.revision,
      })
    }
    const result = command.apply(db)
    db.revision += 1
    if (command.idempotencyKey && command.fingerprint) {
      const receipt =
        result && typeof result === "object" && "receipt" in result && typeof (result as { receipt?: unknown }).receipt === "string"
          ? (result as { receipt: string }).receipt
          : `rev-${db.revision}`
      db.receipts[command.idempotencyKey] = {
        fingerprint: command.fingerprint,
        revision: db.revision,
        receipt,
        result,
      }
    }
    writeAtomic(db)
    return { result, revision: db.revision, duplicate: false }
  })
}

export function publicUser(user: User) {
  return { id: user.id, email: user.email, name: user.name, role: user.role }
}

export function currentDecisions(db: Db) {
  const superseded = new Set(db.decisions.map((item) => item.supersedesId).filter(Boolean))
  return db.decisions.filter((item) => !superseded.has(item.id))
}

export function outcomeView(db: Db) {
  const active = currentDecisions(db)
  return OUTCOMES.map((outcome) => {
    const decision = active.find((item) => item.outcomeId === outcome.id)
    if (!decision) {
      return {
        ...outcome,
        status: outcome.id === "quiz" ? "practice" : "unknown",
        label: outcome.id === "quiz" ? "Chỉ dùng để luyện tập" : "Chưa đủ bằng chứng",
      }
    }
    return {
      ...outcome,
      status: decision.decision,
      label: decision.decision === "met" ? "Đã xác nhận" : "Chưa đạt",
      reason: decision.reason,
      decidedAt: decision.decidedAt,
    }
  })
}

export function hashBody(code: string, reflection: string) {
  return createHash("sha256").update(`${code}\n${reflection}`).digest("hex").slice(0, 12)
}

export class HttpError extends Error {
  status: number
  extra?: Record<string, unknown>

  constructor(status: number, message: string, extra?: Record<string, unknown>) {
    super(message)
    this.status = status
    this.extra = extra
  }
}

export function jsonError(error: unknown) {
  if (error instanceof HttpError) {
    return Response.json({ error: error.message, ...error.extra }, { status: error.status })
  }
  console.error(error)
  return Response.json({ error: "Máy chủ chưa xử lý được yêu cầu." }, { status: 500 })
}
