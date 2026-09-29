export type ItemType = "header" | "page" | "link" | "assignment" | "quiz"
export type CompletionKind = "none" | "view" | "self_mark" | "submit"

export type QuizQuestion = {
  key: string
  prompt: string
  options: string[]
  answer: number
}

export type ModuleItem = {
  key: string
  position: number
  indent: 0 | 1
  title: string
  visible: boolean
  type: ItemType
  resourceVersionKey: string | null
  completion: { kind: CompletionKind }
  quiz?: { questions: QuizQuestion[] }
}

export type AuthoredModule = {
  key: string
  versionKey: string
  title: string
  summary: string
  state: "draft" | "published"
  policy: { mode: "all" | "one" | "none"; sequential: boolean }
  items: ModuleItem[]
}

export type ModuleRelease = {
  releaseKey: string
  moduleVersionKey: string
  position: number
  availableFrom: string
  dueAt: string | null
  prerequisiteReleaseKeys: string[]
  snapshot: AuthoredModule
}

export type PathRelease = {
  pathReleaseKey: string
  offeringId: string
  publishedAt: string
  modules: ModuleRelease[]
}

export type ItemFact = {
  learnerId: string
  moduleReleaseKey: string
  itemKey: string
  completedAt: string
  reason: "view" | "self_mark" | "submit"
}

export type ModuleQuizAttempt = {
  id: string
  learnerId: string
  moduleReleaseKey: string
  itemKey: string
  answers: number[]
  score: number
  total: number
  submittedAt: string
}
