import type { Generated } from 'kysely'

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
  id: string
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

export interface Database {
  schools: SchoolsTable
  users: UsersTable
  school_memberships: SchoolMembershipsTable
  sessions: SessionsTable
  audit_log: AuditLogTable
}
