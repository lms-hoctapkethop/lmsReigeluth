import { commitWrite, HttpError, jsonError, notify, recordAudit, requireExpectedRevision, withDb } from "@/lib/db"
import { assertLearnerAccess, context, overview } from "@/lib/learn"
import { getSessionUser } from "@/lib/session"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const user = await getSessionUser()
    if (!user) throw new HttpError(401, "Hãy đăng nhập lại.")
    const data = await withDb((db) => {
      assertLearnerAccess(db, user)
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
    const body = (await request.json()) as { note?: string; expectedRevision?: number }
    const expectedRevision = requireExpectedRevision(body.expectedRevision)
    const written = await commitWrite({
      expectedRevision,
      apply: (db) => {
      assertLearnerAccess(db, user)
      if (user.role !== "guardian") throw new HttpError(403, "Chỉ phụ huynh được liên kết mới ghi nhận đồng hành.")
      const note = body.note?.trim() ?? ""
      if (note.length < 8) throw new HttpError(400, "Hãy ghi cách bạn sẽ đồng hành, ít nhất một câu.")
      db.familyNotes.push({
        id: `family-${db.familyNotes.length + 1}`,
        guardianId: user.id,
        note: note.slice(0, 500),
        confirmedAt: new Date().toISOString(),
      })
      notify(db, {
        userId: "learner-an",
        title: "Gia đình ghi nhận đồng hành",
        summary: "Có một cam kết hỗ trợ mới. Cam kết này không làm tăng tiến độ.",
        href: "/records",
      })
      notify(db, {
        userId: "teacher-ha",
        title: "Phụ huynh ghi nhận đồng hành",
        summary: "Có một cam kết hỗ trợ mới cho Lê An.",
        href: "/teaching",
      })
      recordAudit(db, { actorId: user.id, actorName: user.name, action: "Ghi hỗ trợ gia đình", target: "Lê An" })
      return { notes: db.familyNotes, context: context(db) }
      },
    })
    return Response.json({ ...written.result, revision: written.revision })
  } catch (error) {
    return jsonError(error)
  }
}
