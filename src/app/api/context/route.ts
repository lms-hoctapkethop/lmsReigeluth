import { ROOT_COURSE_ID } from "@/lib/course-catalog"
import { resolveCourseId } from "@/lib/course-session"
import { coursesForUser, withCourse } from "@/lib/courses"
import { HttpError, jsonError, withDb } from "@/lib/db"
import { getSessionUser } from "@/lib/session"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const user = await getSessionUser()
    if (!user) throw new HttpError(401, "Hãy đăng nhập lại.")
    const courseId = user.role === "admin" ? ROOT_COURSE_ID : await resolveCourseId(user.id)
    const data = await withDb((db) =>
      withCourse(db, courseId, user.role === "admin" ? null : user.id, () => ({
        org: { ...db.org },
        moduleTitle: db.module.title,
        unread: db.notifications.filter((item) => item.userId === user.id && !item.readAt).length,
        activeCourseId: courseId,
        courses: user.role === "admin" ? [] : coursesForUser(db, user.id),
      })),
    )
    return Response.json(data)
  } catch (error) {
    return jsonError(error)
  }
}
