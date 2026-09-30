import { sql, type Kysely } from 'kysely'
import type { Database, Role, UserStatus } from '@hcn/db'

export const schools = {
  an: { id: '20000000-0000-4000-8000-000000000001', code: 'TRUONG_AN', name: 'Trường An' },
  binh: { id: '20000000-0000-4000-8000-000000000002', code: 'TRUONG_BINH', name: 'Trường Bình' },
} as const

function uid(group: string, n: number): string {
  return `${group}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
}

type Persona = {
  username: string
  subject: string
  displayName: string
  status: UserStatus
}

export const personas = {
  hsMinh: { username: 'hs.minh', subject: uid('10000000', 0x11), displayName: 'Minh', status: 'active' },
  gvLan: { username: 'gv.lan', subject: uid('10000000', 0x12), displayName: 'Cô Lan', status: 'active' },
  phMinh: { username: 'ph.minh', subject: uid('10000000', 0x13), displayName: 'Phụ huynh của Minh', status: 'active' },
  adminA: { username: 'admin.a', subject: uid('10000000', 0x14), displayName: 'Quản trị An', status: 'active' },
  userChuaCap: { username: 'user.chua.cap', subject: uid('10000000', 0x15), displayName: 'Chưa cấp quyền', status: 'active' },
  userKhoa: { username: 'user.khoa', subject: uid('10000000', 0x16), displayName: 'Tài khoản bị khóa', status: 'locked' },
  gvHung: { username: 'gv.hung', subject: uid('10000000', 0x17), displayName: 'Thầy Hùng', status: 'active' },
  hsAn: { username: 'hs.an', subject: uid('10000000', 0x18), displayName: 'An', status: 'active' },
  phAn: { username: 'ph.an', subject: uid('10000000', 0x19), displayName: 'Phụ huynh của An', status: 'active' },
  gvB: { username: 'gv.b', subject: uid('10000000', 0x1a), displayName: 'GV Bình', status: 'active' },
  hsB: { username: 'hs.b', subject: uid('10000000', 0x1b), displayName: 'HS Bình', status: 'active' },
  gvLanPh: { username: 'gv.lan.ph', subject: uid('10000000', 0x1c), displayName: 'Cô Lan (PH)', status: 'active' },
  gvTin11: { username: 'gv.tin11', subject: uid('10000000', 0x1d), displayName: 'GV Tin 11', status: 'active' },
  hsBinh: { username: 'hs.binh', subject: uid('10000000', 0x1e), displayName: 'Bình', status: 'active' },
  reviewerTin: { username: 'reviewer.tin', subject: uid('10000000', 0x1f), displayName: 'Thẩm định Tin', status: 'active' },
} as const satisfies Record<string, Persona>

export const academicYears = {
  an: { id: uid('40000000', 1), school: 'an' as const, code: '2026-2027', startsOn: '2026-09-01', endsOn: '2027-05-31' },
  binh: { id: uid('40000000', 2), school: 'binh' as const, code: '2026-2027', startsOn: '2026-09-01', endsOn: '2027-05-31' },
} as const

export const classes = {
  a10a1: { id: uid('41000000', 1), school: 'an' as const, year: 'an' as const, grade: 10, code: '10A1' },
  a10a2: { id: uid('41000000', 2), school: 'an' as const, year: 'an' as const, grade: 10, code: '10A2' },
  a7a4: { id: uid('41000000', 3), school: 'an' as const, year: 'an' as const, grade: 7, code: '7A4' },
  b10b1: { id: uid('41000000', 4), school: 'binh' as const, year: 'binh' as const, grade: 10, code: '10B1' },
} as const

export const courses = {
  tin10: { id: uid('42000000', 1), school: 'an' as const, subject: '1401', grade: 10, title: 'Tin học 10' },
  toan10: { id: uid('42000000', 2), school: 'an' as const, subject: '0201', grade: 10, title: 'Toán 10' },
  toan7: { id: uid('42000000', 3), school: 'an' as const, subject: '0201', grade: 7, title: 'Toán 7' },
  tin11: { id: uid('42000000', 4), school: 'an' as const, subject: '1401', grade: 11, title: 'Tin học 11' },
  tin12: { id: uid('42000000', 5), school: 'an' as const, subject: '1401', grade: 12, title: 'Tin học 12' },
  tin10b: { id: uid('42000000', 6), school: 'binh' as const, subject: '1401', grade: 10, title: 'Tin học 10' },
} as const

const fullCaps = ['teach', 'author', 'release', 'review']

export const offerings = {
  tin10a1: { id: uid('43000000', 1), school: 'an' as const, course: 'tin10' as const, year: 'an' as const, code: 'TIN10A1', title: 'Tin10A1', classId: classes.a10a1.id },
  tin10a2: { id: uid('43000000', 2), school: 'an' as const, course: 'tin10' as const, year: 'an' as const, code: 'TIN10A2', title: 'Tin10A2', classId: classes.a10a2.id },
  toan10a3: { id: uid('43000000', 3), school: 'an' as const, course: 'toan10' as const, year: 'an' as const, code: 'TOAN10A3', title: 'Toán10A3', classId: classes.a10a1.id },
  toan7a4: { id: uid('43000000', 4), school: 'an' as const, course: 'toan7' as const, year: 'an' as const, code: 'TOAN7A4', title: 'Toán7A4', classId: classes.a7a4.id },
  tin11a2: { id: uid('43000000', 5), school: 'an' as const, course: 'tin11' as const, year: 'an' as const, code: 'TIN11A2', title: 'Tin11A2', classId: classes.a10a2.id },
  tin12a3: { id: uid('43000000', 6), school: 'an' as const, course: 'tin12' as const, year: 'an' as const, code: 'TIN12A3', title: 'Tin12A3', classId: classes.a10a1.id },
  tin10b1: { id: uid('43000000', 7), school: 'binh' as const, course: 'tin10b' as const, year: 'binh' as const, code: 'TIN10B1', title: 'Tin10B1', classId: classes.b10b1.id },
} as const

export const assignments = {
  lanTin10a1: { id: uid('44000000', 1), offering: 'tin10a1' as const, teacher: 'gvLan' as const, capabilities: ['teach', 'author', 'release', 'review'] },
  lanTin10a2: { id: uid('44000000', 2), offering: 'tin10a2' as const, teacher: 'gvLan' as const, capabilities: ['review'] },
  lanToan10a3: { id: uid('44000000', 3), offering: 'toan10a3' as const, teacher: 'gvLan' as const, capabilities: ['view'] },
  hungToan7a4: { id: uid('44000000', 4), offering: 'toan7a4' as const, teacher: 'gvHung' as const, capabilities: fullCaps },
  tin11Tin11a2: { id: uid('44000000', 5), offering: 'tin11a2' as const, teacher: 'gvTin11' as const, capabilities: fullCaps },
  tin11Tin12a3: { id: uid('44000000', 6), offering: 'tin12a3' as const, teacher: 'gvTin11' as const, capabilities: fullCaps },
  lanPhTin12a3: { id: uid('44000000', 7), offering: 'tin12a3' as const, teacher: 'gvLanPh' as const, capabilities: fullCaps },
  bTin10b1: { id: uid('44000000', 8), offering: 'tin10b1' as const, teacher: 'gvB' as const, capabilities: fullCaps },
} as const

export const enrollments = {
  minhTin10a1: { id: uid('45000000', 1), offering: 'tin10a1' as const, learner: 'hsMinh' as const },
  minhToan10a3: { id: uid('45000000', 2), offering: 'toan10a3' as const, learner: 'hsMinh' as const },
  anTin10a2: { id: uid('45000000', 3), offering: 'tin10a2' as const, learner: 'hsAn' as const },
  binhToan7a4: { id: uid('45000000', 4), offering: 'toan7a4' as const, learner: 'hsBinh' as const },
  bTin10b1: { id: uid('45000000', 5), offering: 'tin10b1' as const, learner: 'hsB' as const },
} as const

export const guardianLinks = {
  phMinhMinh: { id: uid('46000000', 1), school: 'an' as const, guardian: 'phMinh' as const, learner: 'hsMinh' as const, status: 'verified' as const },
  phAnAn: { id: uid('46000000', 2), school: 'an' as const, guardian: 'phAn' as const, learner: 'hsAn' as const, status: 'verified' as const },
  phAnBinh: { id: uid('46000000', 3), school: 'an' as const, guardian: 'phAn' as const, learner: 'hsBinh' as const, status: 'pending' as const },
  lanPhBinh: { id: uid('46000000', 4), school: 'an' as const, guardian: 'gvLanPh' as const, learner: 'hsBinh' as const, status: 'verified' as const },
  bLink: { id: uid('46000000', 5), school: 'binh' as const, guardian: 'gvB' as const, learner: 'hsB' as const, status: 'verified' as const },
} as const

const classSeats = [
  { id: uid('47000000', 1), classKey: 'a10a1' as const, learner: 'hsMinh' as const },
  { id: uid('47000000', 2), classKey: 'a10a2' as const, learner: 'hsAn' as const },
  { id: uid('47000000', 3), classKey: 'a7a4' as const, learner: 'hsBinh' as const },
  { id: uid('47000000', 4), classKey: 'b10b1' as const, learner: 'hsB' as const },
]

type Membership = { id: string; user: keyof typeof personas; school: keyof typeof schools; role: Role }

const memberships: Membership[] = [
  { id: uid('30000000', 0x11), user: 'hsMinh', school: 'an', role: 'student' },
  { id: uid('30000000', 0x12), user: 'gvLan', school: 'an', role: 'teacher' },
  { id: uid('30000000', 0x14), user: 'phMinh', school: 'an', role: 'guardian' },
  { id: uid('30000000', 0x15), user: 'adminA', school: 'an', role: 'admin' },
  { id: uid('30000000', 0x16), user: 'userKhoa', school: 'an', role: 'student' },
  { id: uid('30000000', 0x17), user: 'gvHung', school: 'an', role: 'teacher' },
  { id: uid('30000000', 0x18), user: 'hsAn', school: 'an', role: 'student' },
  { id: uid('30000000', 0x19), user: 'phAn', school: 'an', role: 'guardian' },
  { id: uid('30000000', 0x1a), user: 'gvB', school: 'binh', role: 'teacher' },
  { id: uid('30000000', 0x1b), user: 'hsB', school: 'binh', role: 'student' },
  { id: uid('30000000', 0x1c), user: 'gvLanPh', school: 'an', role: 'teacher' },
  { id: uid('30000000', 0x1d), user: 'gvLanPh', school: 'an', role: 'guardian' },
  { id: uid('30000000', 0x1e), user: 'gvTin11', school: 'an', role: 'teacher' },
  { id: uid('30000000', 0x1f), user: 'hsBinh', school: 'an', role: 'student' },
  { id: uid('30000000', 0x20), user: 'reviewerTin', school: 'an', role: 'teacher' },
]

const classRange = sql<string>`daterange('2026-09-01'::date, '2027-06-01'::date, '[)')`
const assignmentRange = sql<string>`tstzrange('2026-09-01T00:00:00Z'::timestamptz, NULL, '[)')`

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

  await db.deleteFrom('school_memberships').where('user_id', '=', personas.gvLan.subject).where('role', '=', 'guardian').execute()

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

  await db
    .insertInto('subjects')
    .values([
      { code: '1401', name: 'Tin học', grades: [10, 11, 12] },
      { code: '0201', name: 'Toán', grades: [7, 10] },
    ])
    .onConflict((conflict) => conflict.column('code').doUpdateSet({ name: 'Tin học' }))
    .execute()
  await db.updateTable('subjects').set({ name: 'Toán', grades: [7, 10] }).where('code', '=', '0201').execute()
  await db.updateTable('subjects').set({ name: 'Tin học', grades: [10, 11, 12] }).where('code', '=', '1401').execute()

  for (const year of Object.values(academicYears)) {
    await db
      .insertInto('academic_years')
      .values({
        id: year.id,
        school_id: schools[year.school].id,
        code: year.code,
        starts_on: year.startsOn,
        ends_on: year.endsOn,
      })
      .onConflict((conflict) => conflict.column('id').doNothing())
      .execute()
  }

  for (const item of Object.values(classes)) {
    await db
      .insertInto('admin_classes')
      .values({
        id: item.id,
        school_id: schools[item.school].id,
        academic_year_id: academicYears[item.year].id,
        grade: item.grade,
        code: item.code,
        homeroom_teacher_id: null,
      })
      .onConflict((conflict) => conflict.column('id').doNothing())
      .execute()
  }

  for (const seat of classSeats) {
    const item = classes[seat.classKey]
    await db
      .insertInto('class_memberships')
      .values({
        id: seat.id,
        school_id: schools[item.school].id,
        academic_year_id: academicYears[item.year].id,
        class_id: item.id,
        learner_id: personas[seat.learner].subject,
        valid: classRange,
      })
      .onConflict((conflict) => conflict.column('id').doNothing())
      .execute()
  }

  for (const course of Object.values(courses)) {
    await db
      .insertInto('courses')
      .values({
        id: course.id,
        school_id: schools[course.school].id,
        subject_code: course.subject,
        grade: course.grade,
        title: course.title,
        orientation: null,
      })
      .onConflict((conflict) => conflict.column('id').doNothing())
      .execute()
  }

  for (const offering of Object.values(offerings)) {
    await db
      .insertInto('offerings')
      .values({
        id: offering.id,
        school_id: schools[offering.school].id,
        course_id: courses[offering.course].id,
        academic_year_id: academicYears[offering.year].id,
        term: 1,
        code: offering.code,
        title: offering.title,
        status: 'active',
      })
      .onConflict((conflict) => conflict.column('id').doNothing())
      .execute()
    await db
      .insertInto('offering_class_links')
      .values({ offering_id: offering.id, class_id: offering.classId, school_id: schools[offering.school].id })
      .onConflict((conflict) => conflict.columns(['offering_id', 'class_id']).doNothing())
      .execute()
  }

  for (const assignment of Object.values(assignments)) {
    const offering = offerings[assignment.offering]
    await db
      .insertInto('teacher_assignments')
      .values({
        id: assignment.id,
        school_id: schools[offering.school].id,
        offering_id: offering.id,
        teacher_id: personas[assignment.teacher].subject,
        capabilities: [...assignment.capabilities],
        valid: assignmentRange,
        granted_by: personas.adminA.subject,
      })
      .onConflict((conflict) => conflict.column('id').doNothing())
      .execute()
  }

  for (const enrollment of Object.values(enrollments)) {
    const offering = offerings[enrollment.offering]
    await db
      .insertInto('offering_enrollments')
      .values({
        id: enrollment.id,
        school_id: schools[offering.school].id,
        offering_id: offering.id,
        learner_id: personas[enrollment.learner].subject,
        status: 'active',
        withdrawn_at: null,
      })
      .onConflict((conflict) => conflict.column('id').doNothing())
      .execute()
  }

  for (const link of Object.values(guardianLinks)) {
    const verified = link.status === 'verified'
    await db
      .insertInto('guardian_links')
      .values({
        id: link.id,
        school_id: schools[link.school].id,
        guardian_id: personas[link.guardian].subject,
        learner_id: personas[link.learner].subject,
        relation: 'guardian',
        status: link.status,
        verified_by: verified ? personas.adminA.subject : null,
        verified_at: verified ? new Date('2026-09-02T00:00:00Z') : null,
        revoked_by: null,
        revoked_at: null,
        revoke_reason: null,
      })
      .onConflict((conflict) => conflict.column('id').doNothing())
      .execute()
  }

  await db
    .insertInto('curriculum_reviewers')
    .values({
      user_id: personas.reviewerTin.subject,
      subject_code: '1401',
      granted_by: personas.adminA.subject,
    })
    .onConflict((conflict) => conflict.columns(['user_id', 'subject_code']).doNothing())
    .execute()
}
