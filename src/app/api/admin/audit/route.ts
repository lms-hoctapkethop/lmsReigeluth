import { HttpError, jsonError, withDb } from "@/lib/db"
import { adminAudit } from "@/lib/admin"
import { getSessionUser } from "@/lib/session"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const user = await getSessionUser()
    if (!user) throw new HttpError(401, "Hãy đăng nhập lại.")
    return Response.json(await withDb((db) => adminAudit(db, user)))
  } catch (error) {
    return jsonError(error)
  }
}
