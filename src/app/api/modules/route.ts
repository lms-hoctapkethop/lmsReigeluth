import { commitWrite, HttpError, jsonError, LEARNER, requireExpectedRevision, withDb } from "@/lib/db"
import { markItem, modulesPayload, rejectAttainmentWrite, rejectDisabledDelivery, sampleWeekModule, saveAuthoredModule, submitAssignment, submitModuleQuiz } from "@/lib/modules"
import { getSessionUser } from "@/lib/session"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const user = await getSessionUser()
    if (!user) throw new HttpError(401, "Hãy đăng nhập lại.")
    if (user.role === "admin") throw new HttpError(403, "Tài khoản quản trị không mở hồ sơ học tập.")
    const data = await withDb((db) => modulesPayload(db, user.role))
    return Response.json(data)
  } catch (error) {
    return jsonError(error)
  }
}

export async function POST(request: Request) {
  try {
    const user = await getSessionUser()
    if (!user) throw new HttpError(401, "Hãy đăng nhập lại.")
    const body = (await request.json()) as Record<string, unknown>
    rejectAttainmentWrite(body)
    rejectDisabledDelivery(body)
    const expectedRevision = requireExpectedRevision(body.expectedRevision)
    const written = await commitWrite({
      expectedRevision,
      apply: (db) => {
        if (body.action === "save-sample") {
          if (user.role !== "teacher") throw new HttpError(403, "Chỉ giáo viên soạn module.")
          return saveAuthoredModule(db, sampleWeekModule())
        }
        if (body.action === "save") {
          if (user.role !== "teacher") throw new HttpError(403, "Chỉ giáo viên soạn module.")
          const current = db.authoredModules.find((item) => item.key === body.key)
          if (!current) throw new HttpError(404, "Không thấy bản soạn.")
          return saveAuthoredModule(db, { ...current, title: String(body.title ?? current.title) })
        }
        if (body.action === "mark-done") {
          return markItem(db, {
            learnerId: user.id === LEARNER.id ? LEARNER.id : user.id,
            releaseKey: String(body.releaseKey ?? ""),
            itemKey: String(body.itemKey ?? ""),
          })
        }
        if (body.action === "quiz") {
          return submitModuleQuiz(db, {
            learnerId: user.id,
            releaseKey: String(body.releaseKey ?? ""),
            itemKey: String(body.itemKey ?? ""),
            answers: Array.isArray(body.answers) ? (body.answers as number[]) : [],
          })
        }
        if (body.action === "submit-assignment") {
          return submitAssignment(db, {
            learnerId: user.id,
            releaseKey: String(body.releaseKey ?? ""),
            itemKey: String(body.itemKey ?? ""),
          })
        }
        throw new HttpError(400, "Không rõ thao tác.")
      },
    })
    return Response.json({ ...written.result, revision: written.revision })
  } catch (error) {
    return jsonError(error)
  }
}
