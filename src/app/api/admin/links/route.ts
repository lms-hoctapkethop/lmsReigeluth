import { HttpError, jsonError, withDb, type GuardianLink } from "@/lib/db"
import { adminOrg, saveLink } from "@/lib/admin"
import { getSessionUser } from "@/lib/session"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const user = await getSessionUser()
    if (!user) throw new HttpError(401, "Hãy đăng nhập lại.")
    return Response.json(await withDb((db) => adminOrg(db, user)))
  } catch (error) {
    return jsonError(error)
  }
}

export async function POST(request: Request) {
  try {
    const user = await getSessionUser()
    if (!user) throw new HttpError(401, "Hãy đăng nhập lại.")
    const body = (await request.json()) as { status?: GuardianLink["status"]; reason?: string }
    return Response.json(await withDb((db) => saveLink(db, user, body)))
  } catch (error) {
    return jsonError(error)
  }
}
