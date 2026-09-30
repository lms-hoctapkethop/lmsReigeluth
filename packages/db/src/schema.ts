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
  created_at: Generated<Date>
  updated_at: Generated<Date>
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
  curriculum_reviewers: CurriculumReviewersTable
  courses: CoursesTable
  offerings: OfferingsTable
  offering_class_links: OfferingClassLinksTable
  teacher_assignments: TeacherAssignmentsTable
  offering_enrollments: OfferingEnrollmentsTable
  idempotency_keys: IdempotencyKeysTable
  outbox_events: OutboxEventsTable
}
