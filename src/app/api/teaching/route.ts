import { resolveCourseId } from "@/lib/course-session"
import { withCourse } from "@/lib/courses"
import { commitWrite, HttpError, jsonError, requireExpectedRevision, withDb } from "@/lib/db"
import { publishReview, teachingPayload } from "@/lib/learn"
import { rejectCanvasPrincipal } from "@/lib/modules"
import { getSessionUser } from "@/lib/session"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const user = await getSessionUser()
    if (!user) throw new HttpError(401, "Hãy đăng nhập lại.")
    if (user.role !== "teacher") throw new HttpError(403, "Hàng chờ này dành cho giáo viên được phân công.")
    const courseId = await resolveCourseId(user.id)
    const data = await withDb((db) => withCourse(db, courseId, user.id, () => teachingPayload(db)))
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
      proposedDecisions?: { outcomeId: string; decision: "met" | "not_met"; reason: string }[]
      learnerId?: string
      principal?: string
      actor?: string
      role?: string
      evidence_authority?: string
    }
    rejectCanvasPrincipal(body)
    const expectedRevision = requireExpectedRevision(body.expectedRevision)
    const courseId = await resolveCourseId(user.id)
    const written = await commitWrite({
      expectedRevision,
      apply: (db) =>
        withCourse(db, courseId, user.id, () => publishReview(db, user, {
          versionNo: Number(body.versionNo),
          marks: body.marks ?? [],
          learnerId: body.learnerId,
          feedbackOnly: Array.isArray(body.proposedDecisions) && body.proposedDecisions.length === 0,
          proposedDecisions: body.proposedDecisions,
        })),
    })
    return Response.json({ ...written.result, revision: written.revision })
  } catch (error) {
    return jsonError(error)
  }
}
