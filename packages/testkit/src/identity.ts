import type { Database, Role, UserStatus } from '@hcn/db'
import type { Kysely } from 'kysely'

export const schools = {
  an: { id: '20000000-0000-4000-8000-000000000001', code: 'TRUONG_AN', name: 'Trường An' },
  binh: { id: '20000000-0000-4000-8000-000000000002', code: 'TRUONG_BINH', name: 'Trường Bình' },
} as const

type Persona = {
  username: string
  subject: string
  displayName: string
  status: UserStatus
}

export const personas = {
  hsMinh: { username: 'hs.minh', subject: '10000000-0000-4000-8000-000000000011', displayName: 'Minh', status: 'active' },
  gvLan: { username: 'gv.lan', subject: '10000000-0000-4000-8000-000000000012', displayName: 'Cô Lan', status: 'active' },
  phMinh: { username: 'ph.minh', subject: '10000000-0000-4000-8000-000000000013', displayName: 'Phụ huynh của Minh', status: 'active' },
  adminTruong: { username: 'admin.truong', subject: '10000000-0000-4000-8000-000000000014', displayName: 'Quản trị trường', status: 'active' },
  userChuaCap: { username: 'user.chua.cap', subject: '10000000-0000-4000-8000-000000000015', displayName: 'Chưa cấp quyền', status: 'active' },
  userKhoa: { username: 'user.khoa', subject: '10000000-0000-4000-8000-000000000016', displayName: 'Tài khoản bị khóa', status: 'locked' },
} as const satisfies Record<string, Persona>

type Membership = { id: string; user: keyof typeof personas; school: keyof typeof schools; role: Role }

const memberships: Membership[] = [
  { id: '30000000-0000-4000-8000-000000000011', user: 'hsMinh', school: 'an', role: 'student' },
  { id: '30000000-0000-4000-8000-000000000012', user: 'gvLan', school: 'an', role: 'teacher' },
  { id: '30000000-0000-4000-8000-000000000013', user: 'gvLan', school: 'an', role: 'guardian' },
  { id: '30000000-0000-4000-8000-000000000014', user: 'phMinh', school: 'an', role: 'guardian' },
  { id: '30000000-0000-4000-8000-000000000015', user: 'adminTruong', school: 'an', role: 'admin' },
  { id: '30000000-0000-4000-8000-000000000016', user: 'userKhoa', school: 'an', role: 'student' },
]

export async function seedIdentity(db: Kysely<Database>, options: { issuer: string }): Promise<void> {
  for (const school of Object.values(schools)) {
    await db
      .insertInto('schools')
      .values({ id: school.id, code: school.code, name: school.name })
      .onConflict((conflict) => conflict.column('code').doUpdateSet({ name: school.name }))
      .execute()
  }

  const provisioned = Object.values(personas).filter((persona) => persona.username !== personas.userChuaCap.username)
  for (const persona of provisioned) {
    await db
      .insertInto('users')
      .values({
        id: persona.subject,
        oidc_issuer: options.issuer,
        oidc_subject: persona.subject,
        display_name: persona.displayName,
        email: null,
        status: persona.status,
      })
      .onConflict((conflict) =>
        conflict.columns(['oidc_issuer', 'oidc_subject']).doUpdateSet({
          display_name: persona.displayName,
          status: persona.status,
        }),
      )
      .execute()
  }

  for (const membership of memberships) {
    const persona = personas[membership.user]
    const school = schools[membership.school]
    await db
      .insertInto('school_memberships')
      .values({
        id: membership.id,
        school_id: school.id,
        user_id: persona.subject,
        role: membership.role,
        status: 'active',
      })
      .onConflict((conflict) => conflict.columns(['school_id', 'user_id', 'role']).doUpdateSet({ status: 'active' }))
      .execute()
  }
}
