import { HttpError, jsonError, withDb } from "@/lib/db"
import { adminUsers } from "@/lib/admin"
import { getSessionUser } from "@/lib/session"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const user = await getSessionUser()
    if (!user) throw new HttpError(401, "Hãy đăng nhập lại.")
    return Response.json(await withDb((db) => adminUsers(db, user)))
  } catch (error) {
    return jsonError(error)
  }
}
