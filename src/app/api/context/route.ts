import { HttpError, jsonError, withDb } from "@/lib/db"
import { getSessionUser } from "@/lib/session"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const user = await getSessionUser()
    if (!user) throw new HttpError(401, "Hãy đăng nhập lại.")
    const data = await withDb((db) => ({
      org: db.org,
      moduleTitle: db.module.title,
      unread: db.notifications.filter((item) => item.userId === user.id && !item.readAt).length,
    }))
    return Response.json(data)
  } catch (error) {
    return jsonError(error)
  }
}
