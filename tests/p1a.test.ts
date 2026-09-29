import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { readFileSync, rmSync } from "node:fs"
import { test } from "node:test"
import { commitWrite, commandFingerprint, HttpError, withDb } from "@/lib/db"
import { saveDraft, submitWork } from "@/lib/learn"
import {
  deliverPath,
  effectiveRequirements,
  markItem,
  modulesPayload,
  rejectAttainmentWrite,
  rejectDisabledDelivery,
  sampleWeekModule,
  saveAuthoredModule,
  submitAssignment,
  submitModuleQuiz,
} from "@/lib/modules"
import type { AuthoredModule } from "@/lib/module-types"

const dbPath = process.env.HCN_DB_PATH!
const student = { id: "learner-an", email: "an.le@gds.edu.vn", name: "Lê An", role: "student" as const }

function reset() {
  rmSync(dbPath, { force: true })
}

function readDb() {
  return JSON.parse(readFileSync(dbPath, "utf8")) as {
    revision: number
    weekLabel?: string
    org: { weekLabel: string }
    pathRelease: { pathReleaseKey: string; modules: { releaseKey: string; availableFrom: string; snapshot: { title: string } }[] } | null
    decisions: unknown[]
    itemFacts: unknown[]
    classDeliveryEnabled: boolean
    versions: unknown[]
    draft: { version: number }
    receipts: Record<string, unknown>
  }
}

function codeOf(error: unknown) {
  assert.ok(error instanceof HttpError)
  return error.extra?.code
}

test("adapter JSON và P1a-01 đến P1a-10 trên bản sao cô lập", async () => {
  const results: Record<string, "PASS" | "NOT_RUN"> = {}

  reset()
  const staleDraft = await commitWrite({
    expectedRevision: 0,
    apply: (db) => saveDraft(db, student, { code: "x", reflection: "y", version: 9 }),
  }).then(
    () => null,
    (error: unknown) => error,
  )
  assert.equal((staleDraft as HttpError).status, 409)
  assert.notEqual(codeOf(staleDraft), "REVISION_CONFLICT")
  assert.equal((staleDraft as HttpError).message, "Bản nháp trên máy chủ đã mới hơn. Hãy tải lại trước khi lưu.")
  assert.throws(() => readDb())

  const saved = await commitWrite({
    expectedRevision: 0,
    apply: (db) => saveDraft(db, student, { code: "diem = 7\n", reflection: "nháp", version: 1 }),
  })
  assert.equal(saved.result.draft.version, 2)
  assert.equal(saved.revision, 1)
  const staleSubmit = await commitWrite({
    expectedRevision: 1,
    idempotencyKey: "learner-an:submit:draft-check",
    fingerprint: commandFingerprint({ code: "diem = 7\n", reflection: "Giải thích đủ dài cho lần nộp." }),
    apply: (db) =>
      submitWork(db, student, {
        code: "diem = 7\n",
        reflection: "Giải thích đủ dài cho lần nộp.",
        version: 1,
        idempotencyKey: "draft-check",
      }),
  }).then(
    () => null,
    (error: unknown) => error,
  )
  assert.equal((staleSubmit as HttpError).status, 409)
  assert.notEqual(codeOf(staleSubmit), "REVISION_CONFLICT")
  assert.equal((staleSubmit as HttpError).message, "Bản nháp đã đổi. Hãy lưu lại hoặc tải bản mới trước khi nộp.")
  assert.equal(readDb().revision, 1)
  assert.equal(readDb().versions.length, 0)
  results["draft-409-save"] = "PASS"
  results["draft-409-submit"] = "PASS"

  const reflection = "Giải thích đủ dài cho lần nộp."
  const submitted = await commitWrite({
    expectedRevision: 1,
    idempotencyKey: "learner-an:submit:same",
    fingerprint: commandFingerprint({ code: "diem = 7\n", reflection }),
    apply: (db) => submitWork(db, student, { code: "diem = 7\n", reflection, version: 2, idempotencyKey: "same" }),
  })
  const retried = await commitWrite<typeof submitted.result>({
    expectedRevision: 0,
    idempotencyKey: "learner-an:submit:same",
    fingerprint: commandFingerprint({ code: "diem = 7\n", reflection }),
    apply: () => {
      throw new Error("retry không được ghi lần nữa")
    },
  })
  assert.equal(retried.duplicate, true)
  assert.equal(retried.result.receipt.receipt, submitted.result.receipt.receipt)
  assert.equal(readDb().revision, 2)
  assert.equal(readDb().versions.length, 1)
  const mismatch = await commitWrite({
    expectedRevision: 2,
    idempotencyKey: "learner-an:submit:same",
    fingerprint: commandFingerprint({ code: "diem = 8\n", reflection }),
    apply: () => {
      throw new Error("nội dung khác không được ghi")
    },
  }).then(
    () => null,
    (error: unknown) => error,
  )
  assert.equal(codeOf(mismatch), "IDEMPOTENCY_MISMATCH")
  assert.equal(readDb().versions.length, 1)
  results["idempotency-retry"] = "PASS"
  results["idempotency-mismatch"] = "PASS"

  reset()
  const [first, second] = await Promise.allSettled([
    commitWrite({
      expectedRevision: 0,
      idempotencyKey: "cmd-a",
      fingerprint: "a",
      apply: (db) => {
        db.audit.push({ id: "a", at: "2026-09-29T00:00:00.000Z", actorId: "teacher-ha", actorName: "Nguyễn Hà", action: "a", target: "a" })
        return { receipt: "A" }
      },
    }),
    commitWrite({
      expectedRevision: 0,
      idempotencyKey: "cmd-b",
      fingerprint: "b",
      apply: (db) => {
        db.audit.push({ id: "b", at: "2026-09-29T00:00:00.000Z", actorId: "teacher-ha", actorName: "Nguyễn Hà", action: "b", target: "b" })
        return { receipt: "B" }
      },
    }),
  ])
  const fulfilled = [first, second].filter((item) => item.status === "fulfilled")
  const rejected = [first, second].filter((item) => item.status === "rejected")
  assert.equal(fulfilled.length, 1)
  assert.equal(rejected.length, 1)
  assert.equal(codeOf((rejected[0] as PromiseRejectedResult).reason), "REVISION_CONFLICT")
  const afterConflict = readDb()
  assert.equal(afterConflict.revision, 1)
  assert.equal(afterConflict.org.weekLabel, "28/09 – 04/10/2026")
  results["P1a-08"] = "PASS"

  const child = await new Promise<{ ok: boolean; code?: string }>((resolve, reject) => {
    const subprocess = spawn(process.execPath, ["--experimental-strip-types", "--import", "./tests/register.mjs", "tests/try-write.ts"], {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let out = ""
    subprocess.stdout.on("data", (chunk) => {
      out += String(chunk)
    })
    subprocess.on("exit", (status) => {
      if (status !== 0) {
        reject(new Error(out || `writer phụ thoát ${status}`))
        return
      }
      resolve(JSON.parse(out))
    })
  })
  assert.equal(child.ok, false)
  assert.equal(child.code, "SINGLE_WRITER")
  assert.equal(readDb().revision, 1)
  results["SINGLE_WRITER"] = "PASS"

  reset()
  const sample = sampleWeekModule()
  assert.equal(effectiveRequirements(sample).length, 3)
  assert.equal(sample.items.filter((item) => item.type === "header" || item.completion.kind === "none").length, 2)
  const created = await commitWrite({ expectedRevision: 0, apply: (db) => saveAuthoredModule(db, sample) })
  assert.equal(created.result.requirementCount, 3)
  assert.equal(readDb().org.weekLabel, "28/09 – 04/10/2026")
  results["P1a-01"] = "PASS"

  await commitWrite({
    expectedRevision: 1,
    apply: (db) => {
      db.classDeliveryEnabled = true
      return { enabled: true }
    },
  })
  const delivered = await commitWrite({
    expectedRevision: 2,
    idempotencyKey: "deliver-week",
    fingerprint: "deliver-week",
    apply: (db) =>
      deliverPath(db, {
        pathReleaseKey: "path-demo",
        modules: [{ releaseKey: "rel-1", moduleKey: "TH10-W1", availableFrom: "2026-09-28T00:00:00.000Z", dueAt: null, prerequisiteReleaseKeys: [] }],
      }),
  })
  assert.deepEqual(delivered.result.releaseKeys, ["rel-1"])
  await commitWrite({
    expectedRevision: 3,
    apply: (db) => saveAuthoredModule(db, { ...sample, title: "Tiêu đề nháp đã sửa" }),
  })
  const afterEdit = readDb()
  assert.equal(afterEdit.pathRelease?.modules[0].snapshot.title, "Tuần mẫu")
  assert.equal(afterEdit.org.weekLabel, "28/09 – 04/10/2026")
  assert.equal(effectiveRequirements(sampleWeekModule()).length, 3)
  results["P1a-02"] = "PASS"

  reset()
  await commitWrite({ expectedRevision: 0, apply: (db) => { db.classDeliveryEnabled = true; return { enabled: true } } })
  await commitWrite({ expectedRevision: 1, apply: (db) => saveAuthoredModule(db, sampleWeekModule()) })
  const beforePartial = readDb()
  const partial = await commitWrite({
    expectedRevision: 2,
    apply: (db) =>
      deliverPath(db, {
        pathReleaseKey: "path-bad",
        modules: [
          { releaseKey: "rel-1", moduleKey: "TH10-W1", availableFrom: "2026-09-28T00:00:00.000Z", dueAt: null, prerequisiteReleaseKeys: [] },
          { releaseKey: "rel-2", moduleKey: "KHONG-CO", availableFrom: "2026-09-28T00:00:00.000Z", dueAt: null, prerequisiteReleaseKeys: ["rel-1"] },
        ],
      }),
  }).then(
    () => null,
    (error: unknown) => error,
  )
  assert.equal(codeOf(partial), "MODULE_NOT_FOUND")
  const afterPartial = readDb()
  assert.equal(afterPartial.pathRelease, null)
  assert.equal(afterPartial.revision, beforePartial.revision)
  results["P1a-03"] = "PASS"

  const firstDeliver = await commitWrite({
    expectedRevision: 2,
    idempotencyKey: "deliver-once",
    fingerprint: "deliver-once",
    apply: (db) =>
      deliverPath(db, {
        pathReleaseKey: "path-once",
        modules: [{ releaseKey: "rel-1", moduleKey: "TH10-W1", availableFrom: "2026-09-28T00:00:00.000Z", dueAt: null, prerequisiteReleaseKeys: [] }],
      }),
  })
  const replay = await commitWrite<typeof firstDeliver.result>({
    expectedRevision: 0,
    idempotencyKey: "deliver-once",
    fingerprint: "deliver-once",
    apply: () => {
      throw new Error("không giao lần hai")
    },
  })
  assert.equal(replay.duplicate, true)
  assert.equal(replay.result.pathReleaseKey, firstDeliver.result.pathReleaseKey)
  assert.deepEqual(replay.result.releaseKeys, firstDeliver.result.releaseKeys)
  assert.equal(readDb().pathRelease?.modules.length, 1)
  results["P1a-04"] = "PASS"

  const sequential = await commitWrite({
    expectedRevision: readDb().revision,
    apply: (db) => submitAssignment(db, { learnerId: "learner-an", releaseKey: "rel-1", itemKey: "a", now: "2026-09-29T01:00:00.000Z" }),
  }).then(
    () => null,
    (error: unknown) => error,
  )
  assert.equal(codeOf(sequential), "SEQUENTIAL_LOCKED")
  assert.equal(readDb().itemFacts.length, 0)

  const decisionsBefore = JSON.stringify(readDb().decisions)
  await commitWrite({
    expectedRevision: readDb().revision,
    apply: (db) => markItem(db, { learnerId: "learner-an", releaseKey: "rel-1", itemKey: "p", now: "2026-09-29T01:00:00.000Z" }),
  })
  await commitWrite({
    expectedRevision: readDb().revision,
    apply: (db) => submitAssignment(db, { learnerId: "learner-an", releaseKey: "rel-1", itemKey: "a", now: "2026-09-29T01:00:00.000Z" }),
  })
  const quiz = await commitWrite({
    expectedRevision: readDb().revision,
    apply: (db) => submitModuleQuiz(db, { learnerId: "learner-an", releaseKey: "rel-1", itemKey: "q", answers: [0, 0], now: "2026-09-29T01:00:00.000Z" }),
  })
  assert.equal(quiz.result.score, 0)
  assert.equal(quiz.result.completed, true)
  assert.equal(JSON.stringify(readDb().decisions), decisionsBefore)
  const quizFact = (readDb().itemFacts as { itemKey: string; reason: string }[]).find((fact) => fact.itemKey === "q")
  assert.equal(quizFact?.reason, "submit")
  results["P1a-05"] = "PASS"

  const beforeGate = readFileSync(dbPath, "utf8")
  const minScore = structuredClone(sampleWeekModule())
  ;(minScore.items[4].completion as { kind: string }).kind = "min_score"
  const blocked = await commitWrite({
    expectedRevision: readDb().revision,
    apply: (db) => saveAuthoredModule(db, minScore),
  }).then(
    () => null,
    (error: unknown) => error,
  )
  assert.equal(codeOf(blocked), "FEATURE_NOT_ENABLED")
  const gate = await commitWrite({
    expectedRevision: readDb().revision,
    apply: (db) =>
      deliverPath(db, {
        pathReleaseKey: "path-gate",
        modules: [{ releaseKey: "rel-g", moduleKey: "TH10-W1", availableFrom: "2026-09-28T00:00:00.000Z", dueAt: null, prerequisiteReleaseKeys: [], kcGate: { decision: "achieved" } }],
      }),
  }).then(
    () => null,
    (error: unknown) => error,
  )
  assert.equal(codeOf(gate), "FEATURE_NOT_ENABLED")
  assert.equal(readFileSync(dbPath, "utf8"), beforeGate)
  results["P1a-06"] = "PASS"

  const factsBefore = readDb().itemFacts.length
  await withDb((db) => modulesPayload(db, "student"))
  await withDb((db) => modulesPayload(db, "teacher"))
  await withDb((db) => modulesPayload(db, "guardian"))
  assert.equal(readDb().itemFacts.length, factsBefore)
  results["P1a-07"] = "PASS"

  const early = await commitWrite({
    expectedRevision: readDb().revision,
    apply: (db) => {
      const release = db.pathRelease!.modules[0]
      release.availableFrom = "2026-10-20T00:00:00.000Z"
      return markItem(db, { learnerId: "learner-an", releaseKey: "rel-1", itemKey: "p", now: "2026-09-29T01:00:00.000Z" })
    },
  }).then(
    () => null,
    (error: unknown) => error,
  )
  assert.equal(codeOf(early), "SCHEDULE_LOCKED")
  assert.equal(readDb().pathRelease?.modules[0].availableFrom, "2026-09-28T00:00:00.000Z")
  const outsider = await commitWrite({
    expectedRevision: readDb().revision,
    apply: (db) => markItem(db, { learnerId: "teacher-ha", releaseKey: "rel-1", itemKey: "p", now: "2026-09-29T01:00:00.000Z" }),
  }).then(
    () => null,
    (error: unknown) => error,
  )
  assert.equal(codeOf(outsider), "SCOPE_MISMATCH")
  results["P1a-09"] = "PASS"

  const attainmentBefore = readFileSync(dbPath, "utf8")
  const attainment = await commitWrite({
    expectedRevision: readDb().revision,
    apply: (db) => {
      rejectAttainmentWrite({ decision: "met" })
      db.decisions.push({ id: "nope", outcomeId: "syntax", decision: "met", reason: "quiz", decidedBy: "learner-an", decidedAt: "2026-09-29T00:00:00.000Z" })
      return { ok: true }
    },
  }).then(
    () => null,
    (error: unknown) => error,
  )
  assert.equal(codeOf(attainment), "ATTAINMENT_WRITE_FORBIDDEN")
  assert.equal(readFileSync(dbPath, "utf8"), attainmentBefore)
  results["P1a-10"] = "PASS"

  const secondModule: AuthoredModule = {
    ...sampleWeekModule(),
    key: "TH10-W2",
    versionKey: "TH10-W2.v1",
    items: [sample.items[1]],
  }
  await commitWrite({ expectedRevision: readDb().revision, apply: (db) => saveAuthoredModule(db, secondModule) })
  await commitWrite({
    expectedRevision: readDb().revision,
    apply: (db) =>
      deliverPath(db, {
        pathReleaseKey: "path-two",
        modules: [
          { releaseKey: "rel-a", moduleKey: "TH10-W1", availableFrom: "2026-09-28T00:00:00.000Z", dueAt: null, prerequisiteReleaseKeys: [] },
          { releaseKey: "rel-b", moduleKey: "TH10-W2", availableFrom: "2026-09-28T00:00:00.000Z", dueAt: null, prerequisiteReleaseKeys: ["rel-a"] },
        ],
      }),
  })
  const needsPrior = await commitWrite({
    expectedRevision: readDb().revision,
    apply: (db) => markItem(db, { learnerId: "learner-an", releaseKey: "rel-b", itemKey: "p", now: "2026-09-29T01:00:00.000Z" }),
  }).then(
    () => null,
    (error: unknown) => error,
  )
  assert.equal(codeOf(needsPrior), "PREREQUISITE_LOCKED")
  results["P1a-09"] = "PASS"

  assert.equal(readDb().org.weekLabel, "28/09 – 04/10/2026")
  assert.equal(readDb().classDeliveryEnabled, true)
  const refused = (() => {
    try {
      rejectDisabledDelivery({ action: "deliver" })
      return null
    } catch (error) {
      return error
    }
  })()
  assert.equal((refused as HttpError).status, 403)
  assert.equal(codeOf(refused), "CLASS_DELIVERY_OFF")
  results["CLASS_DELIVERY_HTTP"] = "PASS"
  console.log(JSON.stringify(results))
  for (const [key, value] of Object.entries(results)) assert.equal(value, "PASS", key)
})
