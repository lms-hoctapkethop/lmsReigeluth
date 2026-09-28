import { HttpError, jsonError, withDb } from "@/lib/db"
import { assertLearnerAccess, context, overview } from "@/lib/learn"
import { getSessionUser } from "@/lib/session"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const user = await getSessionUser()
    if (!user) throw new HttpError(401, "Hãy đăng nhập lại.")
    const data = await withDb((db) => {
      assertLearnerAccess(user)
      if (user.role === "student") throw new HttpError(403, "Trang này dành cho gia đình và giáo viên.")
      return { ...overview(db, user), notes: db.familyNotes, canWrite: user.role === "guardian" }
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
    const body = (await request.json()) as { note?: string }
    const data = await withDb((db) => {
      assertLearnerAccess(user)
      if (user.role !== "guardian") throw new HttpError(403, "Chỉ phụ huynh được liên kết mới ghi nhận đồng hành.")
      const note = body.note?.trim() ?? ""
      if (note.length < 8) throw new HttpError(400, "Hãy ghi cách bạn sẽ đồng hành, ít nhất một câu.")
      db.familyNotes.push({
        id: `family-${db.familyNotes.length + 1}`,
        guardianId: user.id,
        note: note.slice(0, 500),
        confirmedAt: new Date().toISOString(),
      })
      return { notes: db.familyNotes, context: context() }
    })
    return Response.json(data)
  } catch (error) {
    return jsonError(error)
  }
}
