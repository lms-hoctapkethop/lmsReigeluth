import { ROOT_COURSE_ID } from "@/lib/course-catalog"
import { coursesForUser } from "@/lib/courses"
import { withDb } from "@/lib/db"
import { readCourseCookie } from "@/lib/session"

export async function resolveCourseId(userId: string) {
  const requested = await readCourseCookie()
  return withDb((db) => {
    const mine = coursesForUser(db, userId)
    if (requested && mine.some((item) => item.id === requested)) return requested
    return mine[0]?.id ?? ROOT_COURSE_ID
  })
}
