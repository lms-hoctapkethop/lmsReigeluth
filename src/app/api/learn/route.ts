import { HttpError, jsonError, withDb } from "@/lib/db"
import { gradeQuiz, learnPayload, markExplore, saveDraft, submitWork } from "@/lib/learn"
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
    }
    const data = await withDb((db) => {
      if (body.action === "save-draft") {
        return saveDraft(db, user, {
          code: body.code ?? "",
          reflection: body.reflection ?? "",
          version: Number(body.version),
        })
      }
      if (body.action === "submit") {
        if (!body.idempotencyKey) throw new HttpError(400, "Thiếu mã gửi lại của lần nộp.")
        return submitWork(db, user, {
          code: body.code ?? "",
          reflection: body.reflection ?? "",
          version: Number(body.version),
          idempotencyKey: body.idempotencyKey,
        })
      }
      if (body.action === "mark-read") return markExplore(db, user)
      if (body.action === "quiz") return gradeQuiz(db, user, body.answers ?? [])
      throw new HttpError(400, "Không rõ thao tác.")
    })
    return Response.json(data)
  } catch (error) {
    return jsonError(error)
  }
}
