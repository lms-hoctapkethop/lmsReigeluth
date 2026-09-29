import type {
  AssignmentWork,
  AuthoredModule,
  ItemFact,
  ModuleQuizAttempt,
  PathRelease,
} from "@/lib/module-types"
import type { Decision, Draft, ModuleDoc, PlanItem, QuizAttempt, QuizItem, Review, SubmissionVersion } from "@/lib/db"

/**
 * Canvas Course: course_code, workflow_state, published? khi state là available,
 * has_many :enrollments. Canvas Enrollment: belongs_to course và user,
 * StudentEnrollment / TeacherEnrollment, workflow_state active.
 * ObserverEnrollment là chỗ phụ huynh xem hồ sơ, không nộp bài.
 */
export const ROOT_COURSE_ID = "course-th10"
export const MATH_COURSE_ID = "course-toan10"

export type CourseWorkflow = "available" | "unpublished"

export type Course = {
  id: string
  name: string
  courseCode: string
  workflowState: CourseWorkflow
  offeringTitle: string
}

export type EnrollmentType = "StudentEnrollment" | "TeacherEnrollment" | "ObserverEnrollment"

export type Enrollment = {
  id: string
  courseId: string
  userId: string
  type: EnrollmentType
  workflowState: "active" | "invited" | "completed"
}

export type SubjectBag = {
  weekLabel: string
  courseTitle: string
  offeringTitle: string
  module: ModuleDoc
  moduleDraft: ModuleDoc
  authoredModules: AuthoredModule[]
  pathRelease: PathRelease | null
  draft: Draft
  versions: SubmissionVersion[]
  reviews: Review[]
  decisions: Decision[]
  quizzes: QuizAttempt[]
  exploreDone: boolean
  plans: PlanItem[]
  itemFacts: ItemFact[]
  moduleQuizAttempts: ModuleQuizAttempt[]
  assignmentWork: AssignmentWork[]
}

const MATH_QUIZ: QuizItem[] = [
  {
    id: "mq1",
    prompt: "Câu nào là mệnh đề?",
    choices: ["2 + 3 = 6", "x bằng mấy?", "Thật đẹp quá!"],
    answer: 0,
    explain: "“2 + 3 = 6” xác định được là sai, nên là một mệnh đề.",
  },
  {
    id: "mq2",
    prompt: "Vì sao “x + 1 = 3” chưa phải mệnh đề khi chưa biết x?",
    choices: [
      "Vì chưa xác định được câu đó đúng hay sai",
      "Vì câu có dấu bằng thì không bao giờ là mệnh đề",
      "Vì mệnh đề không được chứa số",
    ],
    answer: 0,
    explain: "Mệnh đề phải xác định được đúng hoặc sai. Chưa biết x thì câu này còn là mệnh đề chứa biến.",
  },
  {
    id: "mq3",
    prompt: "Mệnh đề “15 chia hết cho 3” là mệnh đề gì?",
    choices: ["Mệnh đề đúng", "Mệnh đề sai", "Không phải mệnh đề"],
    answer: 0,
    explain: "15 = 3 × 5, nên câu này là mệnh đề đúng.",
  },
]

function mathModule(status: ModuleDoc["status"]): ModuleDoc {
  return {
    title: "Bài 01 · Mệnh đề",
    summary: "Nhận ra một câu là mệnh đề khi câu đó xác định được đúng hoặc sai.",
    exploreTitle: "Khám phá: câu nào là mệnh đề?",
    exploreBody: [
      "Mệnh đề là một câu khẳng định mà ta xác định được nó đúng hoặc sai. “2 lớn hơn 1” là mệnh đề đúng. “Hôm nay trời đẹp quá” không phải mệnh đề.",
      "Bài này thuộc Toán 10. Nó không dùng bài rẽ nhánh if–else của Tin học 10.",
    ],
    practiceTitle: "Thực hành: nêu một mệnh đề",
    practicePrompt:
      "Viết một mệnh đề đúng và một câu không phải mệnh đề. Giải thích vì sao câu thứ hai chưa xác định được đúng hay sai.",
    quiz: MATH_QUIZ.map((item) => ({ ...item, choices: [...item.choices] })),
    status,
    version: 1,
    updatedAt: null,
  }
}

export function catalogCourses(): Course[] {
  return [
    {
      id: ROOT_COURSE_ID,
      name: "Tin học 10",
      courseCode: "TH10",
      workflowState: "available",
      offeringTitle: "Tin học 10 · 10A1",
    },
    {
      id: MATH_COURSE_ID,
      name: "Toán 10",
      courseCode: "TOAN10",
      workflowState: "available",
      offeringTitle: "Toán 10 · 10A1",
    },
  ]
}

export function catalogEnrollments(): Enrollment[] {
  return [
    { id: "enr-an-th10", courseId: ROOT_COURSE_ID, userId: "learner-an", type: "StudentEnrollment", workflowState: "active" },
    { id: "enr-ha-th10", courseId: ROOT_COURSE_ID, userId: "teacher-ha", type: "TeacherEnrollment", workflowState: "active" },
    { id: "enr-mai-th10", courseId: ROOT_COURSE_ID, userId: "guardian-mai", type: "ObserverEnrollment", workflowState: "active" },
    { id: "enr-an-toan10", courseId: MATH_COURSE_ID, userId: "learner-an", type: "StudentEnrollment", workflowState: "active" },
    { id: "enr-ha-toan10", courseId: MATH_COURSE_ID, userId: "teacher-ha", type: "TeacherEnrollment", workflowState: "active" },
    { id: "enr-mai-toan10", courseId: MATH_COURSE_ID, userId: "guardian-mai", type: "ObserverEnrollment", workflowState: "active" },
  ]
}

export function mathSubjectSeed(): SubjectBag {
  return {
    weekLabel: "28/09 – 04/10/2026",
    courseTitle: "Toán 10",
    offeringTitle: "Toán 10 · 10A1",
    module: mathModule("published"),
    moduleDraft: mathModule("draft"),
    authoredModules: [],
    pathRelease: null,
    draft: { learnerId: "learner-an", code: "", reflection: "", version: 1, updatedAt: null },
    versions: [],
    reviews: [],
    decisions: [],
    quizzes: [],
    exploreDone: false,
    plans: [
      {
        id: "plan-toan-read",
        learnerId: "learner-an",
        title: "Đọc phần khám phá về mệnh đề",
        due: "2026-09-30",
        source: "assigned",
        done: false,
      },
      {
        id: "plan-toan-practice",
        learnerId: "learner-an",
        title: "Nêu một mệnh đề và một câu không phải mệnh đề",
        due: "2026-10-02",
        source: "assigned",
        done: false,
      },
    ],
    itemFacts: [],
    moduleQuizAttempts: [],
    assignmentWork: [],
  }
}

type CatalogDb = {
  courses: Course[]
  enrollments: Enrollment[]
  subjects: Record<string, SubjectBag>
}

export function ensureCatalog(db: CatalogDb) {
  for (const course of catalogCourses()) {
    if (!db.courses.some((item) => item.id === course.id)) db.courses.push(course)
  }
  for (const enrollment of catalogEnrollments()) {
    if (!db.enrollments.some((item) => item.id === enrollment.id)) db.enrollments.push(enrollment)
  }
  if (!db.subjects[MATH_COURSE_ID]) db.subjects[MATH_COURSE_ID] = mathSubjectSeed()
}
