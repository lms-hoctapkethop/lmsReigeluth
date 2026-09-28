import { HttpError, jsonError, withDb } from "@/lib/db"
import { recordsPayload } from "@/lib/learn"
import { getSessionUser } from "@/lib/session"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const user = await getSessionUser()
    if (!user) throw new HttpError(401, "Hãy đăng nhập lại.")
    const data = await withDb((db) => recordsPayload(db, user))
    return Response.json(data)
  } catch (error) {
    return jsonError(error)
  }
}
