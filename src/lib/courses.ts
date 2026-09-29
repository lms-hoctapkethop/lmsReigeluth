import { ensureCatalog, ROOT_COURSE_ID, type SubjectBag } from "@/lib/course-catalog"
import { HttpError, type Db } from "@/lib/db"

const activeCourseIds = new WeakMap<Db, string>()

export function currentCourseId(db: Db) {
  return activeCourseIds.get(db) ?? ROOT_COURSE_ID
}

export function coursesForUser(db: Db, userId: string) {
  ensureCatalog(db)
  return db.enrollments
    .filter((item) => item.userId === userId && item.workflowState === "active")
    .map((enrollment) => {
      const course = db.courses.find((item) => item.id === enrollment.courseId)
      if (!course || course.workflowState !== "available") return null
      return {
        id: course.id,
        name: course.name,
        courseCode: course.courseCode,
        workflowState: course.workflowState,
        offeringTitle: course.offeringTitle,
        enrollmentType: enrollment.type,
      }
    })
    .filter((item) => item !== null)
}

function capture(db: Db): SubjectBag {
  return {
    weekLabel: db.org.weekLabel,
    courseTitle: db.org.courseTitle,
    offeringTitle: db.org.offeringTitle,
    module: db.module,
    moduleDraft: db.moduleDraft,
    authoredModules: db.authoredModules,
    pathRelease: db.pathRelease,
    draft: db.draft,
    versions: db.versions,
    reviews: db.reviews,
    decisions: db.decisions,
    quizzes: db.quizzes,
    exploreDone: db.exploreDone,
    plans: db.plans,
    itemFacts: db.itemFacts,
    moduleQuizAttempts: db.moduleQuizAttempts,
    assignmentWork: db.assignmentWork,
  }
}

function install(db: Db, bag: SubjectBag) {
  db.org.weekLabel = bag.weekLabel
  db.org.courseTitle = bag.courseTitle
  db.org.offeringTitle = bag.offeringTitle
  db.module = bag.module
  db.moduleDraft = bag.moduleDraft
  db.authoredModules = bag.authoredModules
  db.pathRelease = bag.pathRelease
  db.draft = bag.draft
  db.versions = bag.versions
  db.reviews = bag.reviews
  db.decisions = bag.decisions
  db.quizzes = bag.quizzes
  db.exploreDone = bag.exploreDone
  db.plans = bag.plans
  db.itemFacts = bag.itemFacts
  db.moduleQuizAttempts = bag.moduleQuizAttempts
  db.assignmentWork = bag.assignmentWork
}

export function withCourse<T>(db: Db, courseId: string, userId: string | null, fn: () => T): T {
  ensureCatalog(db)
  const course = db.courses.find((item) => item.id === courseId)
  if (!course) throw new HttpError(404, "Không có khóa học này.")
  if (course.workflowState !== "available") throw new HttpError(403, "Khóa này chưa mở.")
  if (userId) {
    const enrolled = db.enrollments.some(
      (item) => item.courseId === courseId && item.userId === userId && item.workflowState === "active",
    )
    if (!enrolled) throw new HttpError(403, "Bạn chưa được ghi danh khóa này.")
  }
  const previous = activeCourseIds.get(db)
  activeCourseIds.set(db, courseId)
  const restoreId = () => {
    if (previous === undefined) activeCourseIds.delete(db)
    else activeCourseIds.set(db, previous)
  }
  if (courseId === ROOT_COURSE_ID) {
    try {
      return fn()
    } finally {
      restoreId()
    }
  }
  const bag = db.subjects[courseId]
  if (!bag) {
    restoreId()
    throw new HttpError(404, "Khóa này chưa có học phần.")
  }
  const rootBefore = capture(db)
  const bagBefore = structuredClone(bag)
  install(db, bag)
  try {
    const result = fn()
    db.subjects[courseId] = capture(db)
    install(db, rootBefore)
    return result
  } catch (error) {
    db.subjects[courseId] = bagBefore
    install(db, rootBefore)
    throw error
  } finally {
    restoreId()
  }
}
