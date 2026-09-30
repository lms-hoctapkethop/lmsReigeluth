import type { ColumnType, Generated } from 'kysely'

export type Role = 'admin' | 'teacher' | 'student' | 'guardian'
export type UserStatus = 'active' | 'locked'
export type MembershipStatus = 'active' | 'suspended' | 'ended'

export interface SessionContext {
  school_id: string
  role: Role
}

export interface SchoolsTable {
  id: string
  code: string
  name: string
  timezone: Generated<string>
  created_at: Generated<Date>
}

export interface UsersTable {
  id: string
  oidc_issuer: string
  oidc_subject: string
  display_name: string
  email: string | null
  status: UserStatus
  created_at: Generated<Date>
  updated_at: Generated<Date>
}

export interface SchoolMembershipsTable {
  id: Generated<string>
  school_id: string
  user_id: string
  role: Role
  status: MembershipStatus
  created_at: Generated<Date>
}

export interface SessionsTable {
  id_hash: string
  user_id: string
  csrf_token: string
  context: SessionContext
  id_token_hint: string | null
  created_at: Date
  last_seen_at: Date
  expires_at: Date
  revoked_at: Date | null
}

export interface AuditLogTable {
  id: Generated<string>
  school_id: string | null
  actor_id: string | null
  action: string
  object_type: string
  object_id: string
  request_id: string | null
  details: Record<string, string>
  created_at: Generated<Date>
}

export type Capability = 'teach' | 'author' | 'release' | 'review' | 'view'
export type OfferingStatus = 'planned' | 'active' | 'closed'
export type EnrollmentStatus = 'active' | 'withdrawn'
export type GuardianStatus = 'pending' | 'verified' | 'revoked'
export type GuardianRelation = 'father' | 'mother' | 'guardian' | 'other'
export type ReviewStatus = 'unverified' | 'source_checked' | 'approved' | 'rejected'

type DateColumn = ColumnType<Date, string | Date, string | Date>

export interface AcademicYearsTable {
  id: string
  school_id: string
  code: string
  starts_on: DateColumn
  ends_on: DateColumn
}

export interface AdminClassesTable {
  id: string
  school_id: string
  academic_year_id: string
  grade: number
  code: string
  homeroom_teacher_id: string | null
}

export interface ClassMembershipsTable {
  id: Generated<string>
  school_id: string
  academic_year_id: string
  class_id: string
  learner_id: string
  valid: string
  created_at: Generated<Date>
}

export interface GuardianLinksTable {
  id: Generated<string>
  school_id: string
  guardian_id: string
  learner_id: string
  relation: GuardianRelation
  status: GuardianStatus
  requested_at: Generated<Date>
  verified_by: string | null
  verified_at: Date | null
  revoked_by: string | null
  revoked_at: Date | null
  revoke_reason: string | null
}

export interface SubjectsTable {
  code: string
  name: string
  grades: number[]
}

export interface CurriculumRequirementsTable {
  id: Generated<string>
  code791_stem: string
  bloom_level: number | null
  subject_code: string
  grade: number
  unit1: string
  unit2: string
  text: string
  topic_label: string | null
  orientation: string | null
  source_doc: string
  source_locator: string | null
  review_status: ReviewStatus
  reviewed_by: string | null
  reviewed_at: Date | null
  extraction: string
  extraction_flags: string[]
  created_at: Generated<Date>
  updated_at: Generated<Date>
}

export interface KnowledgeComponentsTable {
  id: Generated<string>
  code: string
  subject_code: string
  grade: number
  created_at: Generated<Date>
}

export interface KcVersionsTable {
  id: Generated<string>
  kc_id: string
  version_no: number
  name: string
  description: string | null
  observable_criteria: string
  status: 'proposed' | 'approved' | 'rejected' | 'superseded'
  source: 'teacher' | 'expert' | 'ai_proposal' | 'import'
  ai_proposal_id: string | null
  created_by: string | null
  reviewed_by: string | null
  reviewed_at: Date | null
  created_at: Generated<Date>
}

export interface RequirementKcLinksTable {
  id: Generated<string>
  requirement_id: string
  kc_version_id: string
  coverage: string
  status: 'proposed' | 'approved' | 'rejected'
  source: 'teacher' | 'expert' | 'ai_proposal' | 'import'
  reviewed_by: string | null
  created_by: string | null
  created_at: Generated<Date>
}

export interface KcEdgesTable {
  id: Generated<string>
  from_kc_version_id: string
  to_kc_version_id: string
  edge_type: 'prerequisite' | 'develops_into' | 'part_of'
  status: 'proposed' | 'approved' | 'rejected'
  source: 'teacher' | 'expert' | 'ai_proposal' | 'import'
  rationale: string | null
  reviewed_by: string | null
  created_by: string | null
  created_at: Generated<Date>
}

export interface MisconceptionsTable {
  id: Generated<string>
  code: string
  kc_id: string
  description: string
  status: 'proposed' | 'approved' | 'rejected'
  reviewed_by: string | null
  created_by: string | null
  created_at: Generated<Date>
}

export interface CurriculumReviewLogTable {
  id: Generated<string>
  entity_type: 'requirement' | 'kc_version' | 'kc_edge' | 'requirement_kc_link' | 'misconception'
  entity_id: string
  action: string
  actor_id: string
  from_status: string | null
  to_status: string
  old_text: string | null
  new_text: string | null
  note: string | null
  created_at: Generated<Date>
}

export interface EffectiveKcEdgesTable {
  id: string
  from_kc_version_id: string
  to_kc_version_id: string
  edge_type: 'prerequisite' | 'develops_into' | 'part_of'
  status: 'approved'
  source: 'teacher' | 'expert' | 'ai_proposal' | 'import'
  rationale: string | null
  reviewed_by: string | null
  created_by: string | null
  created_at: Date
}

export interface CurriculumReviewersTable {
  user_id: string
  subject_code: string
  granted_by: string
  granted_at: Generated<Date>
}

export interface CoursesTable {
  id: string
  school_id: string
  subject_code: string
  grade: number
  title: string
  orientation: string | null
  created_at: Generated<Date>
}

export interface OfferingsTable {
  id: string
  school_id: string
  course_id: string
  academic_year_id: string
  term: number
  code: string
  title: string
  status: OfferingStatus
  created_at: Generated<Date>
}

export interface OfferingClassLinksTable {
  offering_id: string
  class_id: string
  school_id: string
}

export interface TeacherAssignmentsTable {
  id: string
  school_id: string
  offering_id: string
  teacher_id: string
  capabilities: string[]
  valid: string
  granted_by: string | null
  created_at: Generated<Date>
}

export interface OfferingEnrollmentsTable {
  id: string
  school_id: string
  offering_id: string
  learner_id: string
  status: EnrollmentStatus
  enrolled_at: Generated<Date>
  withdrawn_at: Date | null
}

export interface IdempotencyKeysTable {
  actor_id: string
  scope: string
  key: string
  request_hash: string
  status: 'in_progress' | 'completed'
  response_status: number | null
  response_body: Record<string, unknown> | null
  created_at: Generated<Date>
  completed_at: Date | null
}

export interface OutboxEventsTable {
  id: Generated<string>
  event_id: Generated<string>
  school_id: string
  aggregate_type: string
  aggregate_id: string
  event_type: string
  payload: Record<string, string>
  created_at: Generated<Date>
  available_at: Generated<Date>
  attempts: Generated<number>
  last_error: string | null
  status: Generated<'pending' | 'done' | 'dead'>
  processed_at: Date | null
}

export interface ModulesTable {
  id: Generated<string>
  school_id: string
  course_id: string
  owner_id: string
  created_at: Generated<Date>
}

export interface ModuleCollaboratorsTable {
  module_id: string
  user_id: string
  role: 'editor' | 'viewer'
}

export interface ModuleDraftsTable {
  module_id: string
  school_id: string
  revision: number
  payload: unknown
  updated_by: string
  updated_at: Date
}

export interface ModuleVersionsTable {
  id: Generated<string>
  school_id: string
  module_id: string
  version_no: number
  title: string
  description: string | null
  requirement_ids: string[]
  coverage_report: unknown
  coverage_ack: unknown | null
  digest: string
  published_by: string
  published_at: Generated<Date>
}

export interface RubricVersionsTable {
  id: Generated<string>
  module_version_id: string
  title: string
  created_at: Generated<Date>
}

export interface RubricCriteriaTable {
  id: Generated<string>
  rubric_version_id: string
  position: number
  title: string
  kc_version_id: string | null
  level_meets: string
  level_developing: string
  level_not_yet: string
}

export interface ModuleItemsTable {
  id: Generated<string>
  module_version_id: string
  position: number
  item_type: 'header' | 'page' | 'assignment' | 'quiz' | 'link'
  indent: number
  title: string
  body: unknown | null
  url: string | null
  completion_rule: 'none' | 'view' | 'self_mark' | 'submit'
  rubric_version_id: string | null
  requirement_ids: string[]
  submission_config: unknown | null
}

export interface AssessmentVersionsTable {
  id: Generated<string>
  module_version_id: string
  module_item_id: string
  purpose: 'diagnostic' | 'practice' | 'exit_ticket' | 'self_assessment' | 'summative'
  max_attempts: number | null
  show_feedback: 'immediate' | 'after_submit' | 'after_due' | 'never'
  hints_enabled: boolean
  shuffle_options: boolean
}

export interface QuestionItemsTable {
  id: Generated<string>
  assessment_version_id: string
  position: number
  qtype: 'single_choice' | 'multi_choice' | 'numeric' | 'short_text'
  stem: unknown
  options: unknown | null
  bloom_target: number
  variant_group: string | null
  difficulty_prior: 'easy' | 'medium' | 'hard' | null
  difficulty_calibrated: string | null
  provisional: boolean
  hints: unknown
  source: 'teacher' | 'library' | 'ai_proposal' | 'import'
  ai_proposal_id: string | null
  approved_by: string | null
}

export interface QuestionKeysTable {
  question_item_id: string
  key: unknown
  rationale: unknown | null
}

export interface QuestionKcLinksTable {
  question_item_id: string
  kc_version_id: string
  role: 'required' | 'observable'
}

export interface OptionMisconceptionsTable {
  question_item_id: string
  option_id: string
  misconception_id: string
}

export interface PathReleasesTable {
  id: Generated<string>
  school_id: string
  offering_id: string
  title: string
  created_by: string
  created_at: Generated<Date>
}

export interface ModuleReleasesTable {
  id: Generated<string>
  school_id: string
  offering_id: string
  path_release_id: string
  module_version_id: string
  position: number
  available_from: Date
  due_at: Date | null
  accept_until: Date | null
  late_policy: 'reject' | 'accept_marked'
  schedule_revision: Generated<number>
  created_at: Generated<Date>
}

export interface ReleaseScheduleChangesTable {
  id: Generated<string>
  module_release_id: string
  from_revision: number
  old_values: unknown
  new_values: unknown
  reason: string
  changed_by: string
  changed_at: Generated<Date>
}

export interface FilesTable {
  id: Generated<string>
  school_id: string
  owner_id: string
  storage_key: string
  sha256: string
  size_bytes: ColumnType<string, number, number>
  mime_detected: string
  original_name: string
  scan_status: 'pending' | 'clean' | 'infected' | 'error'
  scanned_at: Date | null
  created_at: Generated<Date>
}

export interface ContentFilesTable {
  id: Generated<string>
  school_id: string
  module_version_id: string
  module_item_id: string
  file_id: string
  alt: string
  created_at: Generated<Date>
}

export interface ActivityProgressTable {
  id: Generated<string>
  school_id: string
  learner_id: string
  module_release_id: string
  module_item_id: string
  status: 'in_progress' | 'completed'
  completion_rule: 'view' | 'self_mark' | 'submit'
  source_event: string
  completed_at: Date | null
  updated_at: Date
}

export interface SubmissionsTable {
  id: Generated<string>
  school_id: string
  learner_id: string
  module_release_id: string
  module_item_id: string
  status: 'draft' | 'submitted' | 'changes_requested' | 'reviewed'
  current_version_no: number
  draft_revision: number
  draft_body: unknown | null
  draft_updated_at: Date | null
  created_at: Generated<Date>
}

export interface SubmissionVersionsTable {
  id: Generated<string>
  submission_id: string
  version_no: number
  body: unknown
  reflection: string | null
  content_hash: string
  is_late: boolean
  submitted_at: Generated<Date>
}

export interface SubmissionVersionFilesTable {
  submission_version_id: string
  file_id: string
}

export interface ReviewsTable {
  id: string
  school_id: string
  submission_id: string
  status: 'draft' | 'published'
  submission_version_id: string
}

export interface ProcessedEventsTable {
  event_id: string
  consumer: string
  processed_at: Generated<Date>
}

export interface Database {
  schools: SchoolsTable
  users: UsersTable
  school_memberships: SchoolMembershipsTable
  sessions: SessionsTable
  audit_log: AuditLogTable
  academic_years: AcademicYearsTable
  admin_classes: AdminClassesTable
  class_memberships: ClassMembershipsTable
  guardian_links: GuardianLinksTable
  subjects: SubjectsTable
  curriculum_requirements: CurriculumRequirementsTable
  knowledge_components: KnowledgeComponentsTable
  kc_versions: KcVersionsTable
  requirement_kc_links: RequirementKcLinksTable
  kc_edges: KcEdgesTable
  misconceptions: MisconceptionsTable
  curriculum_review_log: CurriculumReviewLogTable
  effective_kc_edges: EffectiveKcEdgesTable
  curriculum_reviewers: CurriculumReviewersTable
  courses: CoursesTable
  offerings: OfferingsTable
  offering_class_links: OfferingClassLinksTable
  teacher_assignments: TeacherAssignmentsTable
  offering_enrollments: OfferingEnrollmentsTable
  idempotency_keys: IdempotencyKeysTable
  outbox_events: OutboxEventsTable
  modules: ModulesTable
  module_collaborators: ModuleCollaboratorsTable
  module_drafts: ModuleDraftsTable
  module_versions: ModuleVersionsTable
  rubric_versions: RubricVersionsTable
  rubric_criteria: RubricCriteriaTable
  module_items: ModuleItemsTable
  assessment_versions: AssessmentVersionsTable
  question_items: QuestionItemsTable
  question_keys: QuestionKeysTable
  question_kc_links: QuestionKcLinksTable
  option_misconceptions: OptionMisconceptionsTable
  path_releases: PathReleasesTable
  module_releases: ModuleReleasesTable
  release_schedule_changes: ReleaseScheduleChangesTable
  files: FilesTable
  content_files: ContentFilesTable
  activity_progress: ActivityProgressTable
  submissions: SubmissionsTable
  submission_versions: SubmissionVersionsTable
  submission_version_files: SubmissionVersionFilesTable
  reviews: ReviewsTable
  processed_events: ProcessedEventsTable
}
