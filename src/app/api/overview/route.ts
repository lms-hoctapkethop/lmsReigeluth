import { jsonError, withDb, HttpError } from "@/lib/db"
import { overview } from "@/lib/learn"
import { getSessionUser } from "@/lib/session"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const user = await getSessionUser()
    if (!user) throw new HttpError(401, "Hãy đăng nhập lại.")
    const data = await withDb((db) => overview(db, user))
    return Response.json(data)
  } catch (error) {
    return jsonError(error)
  }
}
