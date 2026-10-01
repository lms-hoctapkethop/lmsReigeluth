import { readFileSync } from 'node:fs'
import type { Kysely } from 'kysely'
import type { Database } from '@hcn/db'
import {
  assignTeacher,
  bootstrapSchool,
  createAcademicYear,
  createAdminClass,
  createCourse,
  createOffering,
  enrollLearners,
  importUsers,
  listAcademicYears,
  listAdminClasses,
  systemClock,
  type IdpAdmin,
} from '@hcn/domain'
import { ConfigError } from './config.ts'
import type { AppConfig } from './config.ts'
import { writeStagingHistory } from './seed-staging-history.ts'

export const stagingStudents = 27 * 45
export const stagingTeachers = 60
export const stagingGuardians = 300
export const stagingSubmissions = 10_000
export const stagingObservations = 200_000

const syllables = ['an', 'binh', 'chi', 'dung', 'ha', 'khoa', 'lan', 'minh', 'nam', 'phuong', 'quang', 'son', 'tram', 'vy']

export function assertStagingEnv(env: NodeJS.ProcessEnv = process.env): void {
  if (env.HCN_ENV !== 'staging') throw new ConfigError(['HCN_ENV'])
}

function nameAt(index: number): string {
  const family = syllables[index % syllables.length] ?? 'an'
  const given = syllables[Math.floor(index / syllables.length) % syllables.length] ?? 'minh'
  const capital = (value: string) => value.slice(0, 1).toUpperCase() + value.slice(1)
  return `${capital(family)} ${capital(given)}`
}

export type StagingPerson = { username: string; role: 'student' | 'teacher' | 'guardian'; name: string; classCode: string; child: string }

export function stagingRoster(): StagingPerson[] {
  const people: StagingPerson[] = []
  for (let index = 1; index <= stagingStudents; index += 1) {
    const classCode = `STG${String(Math.ceil(index / 45)).padStart(2, '0')}`
    people.push({
      username: `stg.hs${String(index).padStart(4, '0')}`,
      role: 'student',
      name: nameAt(index),
      classCode,
      child: '',
    })
  }
  for (let index = 1; index <= stagingTeachers; index += 1) {
    people.push({ username: `stg.gv${String(index).padStart(3, '0')}`, role: 'teacher', name: nameAt(index + 20), classCode: '', child: '' })
  }
  for (let index = 1; index <= stagingGuardians; index += 1) {
    people.push({
      username: `stg.ph${String(index).padStart(3, '0')}`,
      role: 'guardian',
      name: nameAt(index + 40),
      classCode: '',
      child: `stg.hs${String(index).padStart(4, '0')}`,
    })
  }
  people.push({ username: 'stg.smoke.hs', role: 'student', name: 'Khói Học Sinh', classCode: 'STG01', child: '' })
  people.push({ username: 'stg.smoke.gv', role: 'teacher', name: 'Khói Giáo Viên', classCode: '', child: '' })
  return people
}

export function stagingCsv(people: StagingPerson[]): string {
  const lines = ['ma_dinh_danh,vai_tro,ho_ten,lop,email,ma_hs_con']
  for (const person of people) {
    lines.push([person.username, person.role, person.name, person.classCode, '', person.child].join(','))
  }
  return lines.join('\n')
}

export function stagingClassCodes(): string[] {
  return Array.from({ length: 27 }, (_value, index) => `STG${String(index + 1).padStart(2, '0')}`)
}

function readPassword(file: string | undefined, fallback: string): string {
  if (!file) return fallback
  return readFileSync(file, 'utf8').trim()
}

export async function seedStaging(
  db: Kysely<Database>,
  idp: IdpAdmin,
  config: AppConfig,
): Promise<{ submissions: number; observations: number }> {
  assertStagingEnv()
  const sharedFile = process.env.SYNTHETIC_USER_PASSWORD_FILE
  if (!sharedFile && !process.env.SYNTHETIC_USER_PASSWORD) throw new ConfigError(['SYNTHETIC_USER_PASSWORD'])
  const shared = readPassword(sharedFile, process.env.SYNTHETIC_USER_PASSWORD ?? '')
  let admin = await idp.findByUsername('stg.admin')
  if (!admin) admin = await idp.createUser({ username: 'stg.admin', displayName: 'Quản trị thử', temporaryPassword: shared })
  const school = await bootstrapSchool(db, idp, {
    name: 'Trường thử nghiệm (dữ liệu tổng hợp)',
    code: 'STAGING',
    adminUsername: 'stg.admin',
    issuer: config.oidcIssuer,
    requestId: 'seed-staging',
  })
  const meta = { actor: { userId: school.userId, schoolId: school.schoolId, roles: ['admin' as const] }, requestId: 'seed-staging', clock: systemClock }
  const years = await listAcademicYears(db, meta)
  const year = years.find((item) => item.code === '2026-2027') ?? await createAcademicYear(db, meta, { code: '2026-2027', startsOn: '2026-09-01', endsOn: '2027-05-31' })
  const existingClasses = new Set((await listAdminClasses(db, meta)).filter((item) => item.academicYearId === year.id).map((item) => item.code))
  for (const [index, code] of stagingClassCodes().entries()) {
    if (existingClasses.has(code)) continue
    await createAdminClass(db, meta, { academicYearId: year.id, grade: (index % 7) + 6, code })
  }
  let courseId: string | undefined
  const existingCourse = await db.selectFrom('courses').select(['id']).where('school_id', '=', school.schoolId).where('title', '=', 'Tin học 10').executeTakeFirst()
  if (existingCourse) courseId = existingCourse.id
  else courseId = (await createCourse(db, meta, { subjectCode: '1401', grade: 10, title: 'Tin học 10' })).id
  const roster = stagingRoster()
  const learners = roster.filter((person) => person.role !== 'guardian')
  const guardians = roster.filter((person) => person.role === 'guardian')
  await importUsers(db, meta, idp, { csv: stagingCsv(learners), idempotencyKey: 'seed-staging-learners', issuer: config.oidcIssuer })
  await importUsers(db, meta, idp, { csv: stagingCsv(guardians), idempotencyKey: 'seed-staging-guardians', issuer: config.oidcIssuer })
  for (const person of roster) {
    const account = await idp.findByUsername(person.username)
    if (!account) continue
    const password = person.username === 'stg.smoke.hs'
      ? readPassword(process.env.SMOKE_HS_PASSWORD_FILE, shared)
      : person.username === 'stg.smoke.gv'
        ? readPassword(process.env.SMOKE_GV_PASSWORD_FILE, shared)
        : shared
    await idp.resetTemporaryPassword(account.id, password)
  }
  const smokeTeacher = await idp.findByUsername('stg.smoke.gv')
  const smokeStudent = await idp.findByUsername('stg.smoke.hs')
  if (smokeTeacher && smokeStudent && courseId) {
    const offering = await createOffering(db, meta, {
      courseId,
      academicYearId: year.id,
      term: 1,
      code: 'KIEMTHU',
      title: 'KIỂM THỬ',
    }).catch(async () => {
      const row = await db.selectFrom('offerings').select(['id']).where('school_id', '=', school.schoolId).where('code', '=', 'KIEMTHU').executeTakeFirst()
      if (!row) throw new Error('Không tạo được offering KIỂM THỬ')
      return { id: row.id }
    })
    await assignTeacher(db, meta, { offeringId: offering.id, teacherId: smokeTeacher.id })
    await enrollLearners(db, meta, { offeringId: offering.id, learnerIds: [smokeStudent.id] })
    const history = await writeStagingHistory(db, idp, {
      schoolId: school.schoolId,
      adminId: school.userId,
      teacherId: smokeTeacher.id,
      offeringId: offering.id,
      courseId,
    })
    console.log(`students=${stagingStudents} teachers=${stagingTeachers} guardians=${stagingGuardians} submissions=${history.submissions} observations=${history.observations}`)
    return history
  }
  throw new Error('seed-staging thiếu giáo viên khói, học sinh khói hoặc khóa học')
}
