export type CriterionLevel = 'meets' | 'developing' | 'not_yet' | 'not_shown'

export type CriterionDto = {
  criterionId: string
  title: string
  level: CriterionLevel | null
  note: string | null
  levels: { meets: string; developing: string; notYet: string }
}

export type RequirementDto = {
  id: string
  code791Stem: string
  bloomLevel: number | null
  subjectCode: string
  grade: number
  text: string
  orientation: string | null
  reviewStatus: string
  extraction: string
}

export type ReviewDraftDto = {
  id: string
  revision: number
  submissionId: string
  submissionVersionId: string
  isCurrentVersion: boolean
  currentVersionId: string
  currentSubmittedAt: string | null
  learnerName: string
  itemTitle: string
  versionNo: number
  submittedAt: string
  comment: string | null
  criteria: CriterionDto[]
  requirements: RequirementDto[]
}

export type DecisionDto = {
  id: string
  requirementId: string
  decision: 'achieved' | 'not_yet'
  decidedAt: string
  supersedesId: string | null
}

export type PublishedReviewDto = {
  id: string
  submissionVersionId: string
  publishedAt: string
  outcome: 'reviewed' | 'changes_requested'
  comment: string | null
  criteria: CriterionDto[]
  decisions: DecisionDto[]
}
