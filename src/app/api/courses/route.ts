import { resolveCourseId } from "@/lib/course-session"
import { coursesForUser } from "@/lib/courses"
import { HttpError, jsonError, withDb } from "@/lib/db"
import { getSessionUser, setCourseCookie } from "@/lib/session"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const user = await getSessionUser()
    if (!user) throw new HttpError(401, "Hãy đăng nhập lại.")
    const activeCourseId = user.role === "admin" ? null : await resolveCourseId(user.id)
    const courses = await withDb((db) => (user.role === "admin" ? [] : coursesForUser(db, user.id)))
    return Response.json({ activeCourseId, courses })
  } catch (error) {
    return jsonError(error)
  }
}

export async function POST(request: Request) {
  try {
    const user = await getSessionUser()
    if (!user) throw new HttpError(401, "Hãy đăng nhập lại.")
    if (user.role === "admin") throw new HttpError(403, "Quản trị không ghi danh vào khóa học của học sinh.")
    const body = (await request.json()) as { courseId?: string }
    const courseId = String(body.courseId ?? "")
    const allowed = await withDb((db) => coursesForUser(db, user.id).some((item) => item.id === courseId))
    if (!allowed) throw new HttpError(403, "Bạn chưa được ghi danh khóa này.")
    await setCourseCookie(courseId)
    return Response.json({ activeCourseId: courseId })
  } catch (error) {
    return jsonError(error)
  }
}
