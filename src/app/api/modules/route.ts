import { suggestAuthoring } from "@/lib/authoring"
import { commitWrite, HttpError, jsonError, LEARNER, requireExpectedRevision, withDb } from "@/lib/db"
import { deliverModule, deliverPath, markItem, modulesPayload, rejectAttainmentWrite, rejectDisabledDelivery, sampleWeekModule, saveAuthoredModule, saveLessonDraft, submitAssignment, submitModuleQuiz } from "@/lib/modules"
import type { AuthoredModule } from "@/lib/module-types"
import { getSessionUser } from "@/lib/session"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    const user = await getSessionUser()
    if (!user) throw new HttpError(401, "Hãy đăng nhập lại.")
    if (user.role === "admin") throw new HttpError(403, "Tài khoản quản trị không mở hồ sơ học tập.")
    const suggest = new URL(request.url).searchParams.get("suggest")
    if (suggest) {
      if (user.role !== "teacher") throw new HttpError(403, "Chỉ giáo viên xem nội dung đề xuất.")
      return Response.json(suggestAuthoring(suggest))
    }
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
    const expectedRevision = requireExpectedRevision(body.expectedRevision)
    const written = await commitWrite({
      expectedRevision,
      apply: (db) => {
        rejectDisabledDelivery(body, db.classDeliveryEnabled)
        const weekLabel = db.org.weekLabel
        const lessonTitle = db.module.title
        const finish = <T,>(result: T) => {
          if (db.org.weekLabel !== weekLabel || db.module.title !== lessonTitle) {
            throw new HttpError(500, "Lệnh module không được đổi tuần lớp hoặc bài đang học.")
          }
          return result
        }
        if (body.action === "deliver") {
          if (user.role !== "teacher") throw new HttpError(403, "Chỉ giáo viên giao được module.")
          const modules = body.modules
          if (!Array.isArray(modules)) throw new HttpError(400, "Thiếu danh sách module để giao.")
          return finish(deliverPath(db, { pathReleaseKey: String(body.pathReleaseKey ?? ""), modules: modules as never }))
        }
        if (body.action === "import-draft") {
          if (user.role !== "teacher") throw new HttpError(403, "Chỉ giáo viên nhập bản soạn.")
          const moduleDoc = body.module
          if (!moduleDoc || typeof moduleDoc !== "object") throw new HttpError(400, "Thiếu bản soạn.")
          return finish(saveAuthoredModule(db, moduleDoc as AuthoredModule))
        }
        if (body.action === "save-sample") {
          if (user.role !== "teacher") throw new HttpError(403, "Chỉ giáo viên soạn module.")
          return finish(saveAuthoredModule(db, sampleWeekModule()))
        }
        if (body.action === "save" || body.action === "save-lesson") {
          if (user.role !== "teacher") throw new HttpError(403, "Chỉ giáo viên soạn module.")
          return finish(saveLessonDraft(db, {
            key: String(body.key ?? ""),
            title: String(body.title ?? ""),
            pageBody: String(body.pageBody ?? ""),
            assignmentPrompt: String(body.assignmentPrompt ?? ""),
            linkHref: body.linkHref ? String(body.linkHref) : undefined,
          }))
        }
        if (body.action === "deliver-module") {
          if (user.role !== "teacher") throw new HttpError(403, "Chỉ giáo viên giao được module.")
          return finish(deliverModule(db, String(body.moduleKey ?? "")))
        }
        if (body.action === "mark-done") {
          return finish(markItem(db, {
            learnerId: user.id === LEARNER.id ? LEARNER.id : user.id,
            releaseKey: String(body.releaseKey ?? ""),
            itemKey: String(body.itemKey ?? ""),
          }))
        }
        if (body.action === "quiz") {
          return finish(submitModuleQuiz(db, {
            learnerId: user.id,
            releaseKey: String(body.releaseKey ?? ""),
            itemKey: String(body.itemKey ?? ""),
            answers: Array.isArray(body.answers) ? (body.answers as number[]) : [],
          }))
        }
        if (body.action === "submit-assignment") {
          return finish(submitAssignment(db, {
            learnerId: user.id,
            releaseKey: String(body.releaseKey ?? ""),
            itemKey: String(body.itemKey ?? ""),
            text: typeof body.text === "string" ? body.text : undefined,
          }))
        }
        throw new HttpError(400, "Không rõ thao tác.")
      },
    })
    return Response.json({ ...written.result, revision: written.revision })
  } catch (error) {
    return jsonError(error)
  }
}
