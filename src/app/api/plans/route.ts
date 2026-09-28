import { HttpError, jsonError, withDb } from "@/lib/db"
import { assertLearnerAccess, context } from "@/lib/learn"
import { getSessionUser } from "@/lib/session"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const user = await getSessionUser()
    if (!user) throw new HttpError(401, "Hãy đăng nhập lại.")
    const data = await withDb((db) => {
      assertLearnerAccess(db, user)
      return { ...context(db), plans: db.plans, canEdit: user.role === "student" }
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
    const body = (await request.json()) as {
      action?: string
      id?: string
      title?: string
      due?: string
    }
    const data = await withDb((db) => {
      assertLearnerAccess(db, user)
      if (user.role !== "student") {
        throw new HttpError(403, "Chỉ học sinh sửa được kế hoạch của mình.")
      }
      if (body.action === "toggle") {
        const item = db.plans.find((plan) => plan.id === body.id)
        if (!item) throw new HttpError(404, "Không thấy nhiệm vụ này.")
        item.done = !item.done
        return { plans: db.plans }
      }
      const title = body.title?.trim() ?? ""
      const due = body.due ?? ""
      if (title.length < 3) throw new HttpError(400, "Hãy ghi một việc cụ thể.")
      if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) throw new HttpError(400, "Chọn ngày trong tuần này.")
      if (due < "2026-09-28" || due > "2026-10-04") {
        throw new HttpError(400, "Tuần này chỉ nhận việc từ 28/09 đến 04/10/2026.")
      }
      db.plans.push({
        id: `plan-${crypto.randomUUID().slice(0, 8)}`,
        learnerId: "learner-an",
        title: title.slice(0, 140),
        due,
        source: "personal",
        done: false,
      })
      return { plans: db.plans }
    })
    return Response.json(data)
  } catch (error) {
    return jsonError(error)
  }
}
