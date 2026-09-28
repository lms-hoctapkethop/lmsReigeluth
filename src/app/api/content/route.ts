import { HttpError, jsonError, withDb, type ModuleDoc } from "@/lib/db"
import { contentPayload, publishModule, saveModuleDraft } from "@/lib/content"
import { getSessionUser } from "@/lib/session"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const user = await getSessionUser()
    if (!user) throw new HttpError(401, "Hãy đăng nhập lại.")
    const data = await withDb((db) => contentPayload(db, user))
    return Response.json(data)
  } catch (error) {
    return jsonError(error)
  }
}

export async function POST(request: Request) {
  try {
    const user = await getSessionUser()
    if (!user) throw new HttpError(401, "Hãy đăng nhập lại.")
    const body = (await request.json()) as { action?: string; draft?: ModuleDoc }
    const data = await withDb((db) => {
      if (body.action === "save") {
        if (!body.draft) throw new HttpError(400, "Thiếu nội dung bản nháp.")
        return saveModuleDraft(db, user, body.draft)
      }
      if (body.action === "publish") return publishModule(db, user)
      throw new HttpError(400, "Không rõ thao tác.")
    })
    return Response.json(data)
  } catch (error) {
    return jsonError(error)
  }
}
