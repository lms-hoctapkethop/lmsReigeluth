import { commandFingerprint, commitWrite, HttpError, jsonError, requireExpectedRevision, withDb } from "@/lib/db"
import { gradeQuiz, learnPayload, markExplore, saveDraft, submitWork } from "@/lib/learn"
import { rejectAttainmentWrite } from "@/lib/modules"
import { getSessionUser } from "@/lib/session"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const user = await getSessionUser()
    if (!user) throw new HttpError(401, "Hãy đăng nhập lại.")
    const data = await withDb((db) => learnPayload(db, user))
    return Response.json(data)
  } catch (error) {
    return jsonError(error)
  }
}

export async function POST(request: Request) {
  try {
    const user = await getSessionUser()
    if (!user) throw new HttpError(401, "Hãy đăng nhập lại.")
    const body = (await request.json()) as {
      action?: string
      code?: string
      reflection?: string
      version?: number
      idempotencyKey?: string
      answers?: number[]
      expectedRevision?: number
      decision?: unknown
      attainment?: unknown
      outcomeId?: unknown
      recordAttainment?: boolean
    }
    rejectAttainmentWrite(body)
    const expectedRevision = requireExpectedRevision(body.expectedRevision)
    const code = body.code ?? ""
    const reflection = body.reflection ?? ""
    const written = await commitWrite({
      expectedRevision,
      idempotencyKey: body.action === "submit" ? `${user.id}:submit:${body.idempotencyKey ?? ""}` : undefined,
      fingerprint: body.action === "submit" ? commandFingerprint({ code, reflection }) : undefined,
      apply: (db) => {
        if (body.action === "save-draft") {
          return saveDraft(db, user, { code, reflection, version: Number(body.version) })
        }
        if (body.action === "submit") {
          if (!body.idempotencyKey) throw new HttpError(400, "Thiếu mã gửi lại của lần nộp.")
          return submitWork(db, user, { code, reflection, version: Number(body.version), idempotencyKey: body.idempotencyKey })
        }
        if (body.action === "mark-read") return markExplore(db, user)
        if (body.action === "quiz") return gradeQuiz(db, user, body.answers ?? [])
        throw new HttpError(400, "Không rõ thao tác.")
      },
    })
    return Response.json({ ...written.result, revision: written.revision, duplicate: written.duplicate })
  } catch (error) {
    return jsonError(error)
  }
}
