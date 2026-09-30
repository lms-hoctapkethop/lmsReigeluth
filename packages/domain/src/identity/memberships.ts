import type { Database, Role } from '@hcn/db'
import type { Kysely, Transaction } from 'kysely'
import { sortMemberships, type MembershipView } from './context.ts'

type Db = Kysely<Database> | Transaction<Database>

export async function listActiveMemberships(db: Db, userId: string): Promise<MembershipView[]> {
  const rows = await db
    .selectFrom('school_memberships')
    .innerJoin('schools', 'schools.id', 'school_memberships.school_id')
    .select([
      'school_memberships.id as id',
      'school_memberships.school_id as schoolId',
      'school_memberships.role as role',
      'schools.name as schoolName',
    ])
    .where('school_memberships.user_id', '=', userId)
    .where('school_memberships.status', '=', 'active')
    .execute()

  return sortMemberships(
    rows.map((row) => ({
      id: row.id,
      schoolId: row.schoolId,
      schoolName: row.schoolName,
      role: row.role as Role,
    })),
  )
}
