import { commitWrite, HttpError, jsonError, requireExpectedRevision, withDb } from "@/lib/db"
import { publishReview, teachingPayload } from "@/lib/learn"
import { getSessionUser } from "@/lib/session"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const user = await getSessionUser()
    if (!user) throw new HttpError(401, "Hãy đăng nhập lại.")
    if (user.role !== "teacher") throw new HttpError(403, "Hàng chờ này dành cho giáo viên được phân công.")
    const data = await withDb((db) => teachingPayload(db))
    return Response.json(data)
  } catch (error) {
    return jsonError(error)
  }
}

export async function POST(request: Request) {
  try {
    const user = await getSessionUser()
    if (!user) throw new HttpError(401, "Hãy đăng nhập lại.")
    const body = (await request.json()) as {
      versionNo?: number
      marks?: { id: string; met: boolean; note: string }[]
      expectedRevision?: number
    }
    const expectedRevision = requireExpectedRevision(body.expectedRevision)
    const written = await commitWrite({
      expectedRevision,
      apply: (db) =>
        publishReview(db, user, {
          versionNo: Number(body.versionNo),
          marks: body.marks ?? [],
        }),
    })
    return Response.json({ ...written.result, revision: written.revision })
  } catch (error) {
    return jsonError(error)
  }
}
