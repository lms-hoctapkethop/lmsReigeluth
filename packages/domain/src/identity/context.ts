import type { Role } from '@hcn/db'

export type MembershipView = {
  id: string
  schoolId: string
  schoolName: string
  role: Role
}

const rank: Record<Role, number> = {
  teacher: 0,
  admin: 1,
  guardian: 2,
  student: 3,
}

export function sortMemberships(memberships: MembershipView[]): MembershipView[] {
  return [...memberships].sort(
    (left, right) => rank[left.role] - rank[right.role] || left.schoolName.localeCompare(right.schoolName, 'vi'),
  )
}

export function chooseContext(memberships: MembershipView[]): MembershipView | null {
  return sortMemberships(memberships)[0] ?? null
}
