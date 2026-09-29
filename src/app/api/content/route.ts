import { resolveCourseId } from "@/lib/course-session"
import { withCourse } from "@/lib/courses"
import { commitWrite, HttpError, jsonError, requireExpectedRevision, withDb, type ModuleDoc } from "@/lib/db"
import { contentPayload, publishModule, saveModuleDraft } from "@/lib/content"
import { getSessionUser } from "@/lib/session"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const user = await getSessionUser()
    if (!user) throw new HttpError(401, "Hãy đăng nhập lại.")
    const courseId = await resolveCourseId(user.id)
    const data = await withDb((db) => withCourse(db, courseId, user.id, () => contentPayload(db, user)))
    return Response.json(data)
  } catch (error) {
    return jsonError(error)
  }
}

export async function POST(request: Request) {
  try {
    const user = await getSessionUser()
    if (!user) throw new HttpError(401, "Hãy đăng nhập lại.")
    const body = (await request.json()) as { action?: string; draft?: ModuleDoc; expectedRevision?: number }
    const expectedRevision = requireExpectedRevision(body.expectedRevision)
    const courseId = await resolveCourseId(user.id)
    const written = await commitWrite({
      expectedRevision,
      apply: (db) => withCourse(db, courseId, user.id, () => {
        if (body.action === "save") {
          if (!body.draft) throw new HttpError(400, "Thiếu nội dung bản nháp.")
          return saveModuleDraft(db, user, body.draft)
        }
        if (body.action === "publish") return publishModule(db, user)
        throw new HttpError(400, "Không rõ thao tác.")
      }),
    })
    return Response.json({ ...written.result, revision: written.revision })
  } catch (error) {
    return jsonError(error)
  }
}
