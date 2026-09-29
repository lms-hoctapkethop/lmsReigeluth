import { commitWrite } from "@/lib/db"

const outcome = await commitWrite({
  expectedRevision: 0,
  apply: (db) => {
    db.audit.push({ id: "other-writer", at: new Date().toISOString(), actorId: "x", actorName: "x", action: "ghi", target: "x" })
    return { ok: true }
  },
}).then(
  () => ({ ok: true }),
  (error: { status?: number; extra?: { code?: string } }) => ({ ok: false, status: error.status, code: error.extra?.code }),
)

console.log(JSON.stringify(outcome))
