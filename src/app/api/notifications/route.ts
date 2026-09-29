import { commitWrite, HttpError, jsonError, requireExpectedRevision, withDb } from "@/lib/db"
import { getSessionUser } from "@/lib/session"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const user = await getSessionUser()
    if (!user) throw new HttpError(401, "Hãy đăng nhập lại.")
    const data = await withDb((db) => {
      const items = db.notifications.filter((item) => item.userId === user.id).slice(0, 50)
      return { items, unread: items.filter((item) => !item.readAt).length, revision: db.revision }
    })
    return Response.json(data)
  } catch (error) {
    return jsonError(error)
  }
}

export async function POST(request: Request) {
  try {
    const user = await getSessionUser()
    if (!user) throw new HttpError(401, "Hãy đăng nhập lại.")
    const body = (await request.json()) as { id?: string; all?: boolean; expectedRevision?: number }
    const expectedRevision = requireExpectedRevision(body.expectedRevision)
    const written = await commitWrite({
      expectedRevision,
      apply: (db) => {
      const now = new Date().toISOString()
      for (const item of db.notifications) {
        if (item.userId !== user.id || item.readAt) continue
        if (body.all || item.id === body.id) item.readAt = now
      }
      const items = db.notifications.filter((item) => item.userId === user.id).slice(0, 50)
      return { items, unread: items.filter((item) => !item.readAt).length }
      },
    })
    return Response.json({ ...written.result, revision: written.revision })
  } catch (error) {
    return jsonError(error)
  }
}
