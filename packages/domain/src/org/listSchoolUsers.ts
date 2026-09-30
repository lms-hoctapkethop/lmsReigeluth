import { sql } from 'kysely'
import { DomainError } from '../errors.ts'
import { requireOrg, type Db, type Meta } from './support.ts'

const fromMarks = 'àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ'
const toMarks = 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd'

function foldExpr(column: 'display_name' | 'email') {
  return sql`translate(lower(${sql.ref(column)}::text), ${fromMarks}, ${toMarks})`
}

export type SchoolUser = {
  id: string
  displayName: string
  email: string | null
  status: 'active' | 'locked'
  roles: string[]
}

export async function listSchoolUsers(
  db: Db,
  meta: Meta,
  input: { q?: string; role?: string; classId?: string; cursor?: string; limit?: number },
): Promise<{ items: SchoolUser[]; nextCursor: string | null }> {
  requireOrg(meta.actor)
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100)
  const cursor = decodeCursor(input.cursor)
  let query = db
    .selectFrom('users')
    .innerJoin('school_memberships', 'school_memberships.user_id', 'users.id')
    .select(['users.id as id', 'users.display_name as displayName', 'users.email as email', 'users.status as status', 'school_memberships.role as role'])
    .where('school_memberships.school_id', '=', meta.actor.schoolId)
    .where('school_memberships.status', '=', 'active')
  if (input.role) query = query.where('school_memberships.role', '=', input.role as 'admin' | 'teacher' | 'student' | 'guardian')
  if (input.q && input.q.trim().length > 0) {
    const needle = `%${input.q.trim().toLowerCase()}%`
    query = query.where(sql<boolean>`(${foldExpr('display_name')} LIKE translate(lower(${needle}), ${fromMarks}, ${toMarks}) OR ${foldExpr('email')} LIKE translate(lower(${needle}), ${fromMarks}, ${toMarks}))`)
  }
  if (input.classId) {
    const day = meta.clock.now().toISOString().slice(0, 10)
    query = query.where(
      sql<boolean>`exists (select 1 from class_memberships cm where cm.learner_id = users.id and cm.class_id = ${input.classId} and cm.school_id = ${meta.actor.schoolId} and cm.valid @> ${day}::date)`,
    )
  }
  const rows = await query.orderBy('users.display_name').orderBy('users.id').execute()
  const grouped = new Map<string, SchoolUser>()
  for (const row of rows) {
    const current = grouped.get(row.id)
    if (current) current.roles.push(row.role)
    else grouped.set(row.id, { id: row.id, displayName: row.displayName, email: row.email, status: row.status, roles: [row.role] })
  }
  const all = [...grouped.values()]
  const start = cursor ? all.findIndex((item) => item.displayName > cursor.name || (item.displayName === cursor.name && item.id > cursor.id)) : 0
  const page = all.slice(Math.max(start, 0), Math.max(start, 0) + limit + 1)
  const items = page.slice(0, limit)
  const last = items[items.length - 1]
  const nextCursor = page.length > limit && last ? encodeCursor(last.displayName, last.id) : null
  return { items, nextCursor }
}

function encodeCursor(name: string, id: string): string {
  return Buffer.from(JSON.stringify({ n: name, i: id }), 'utf8').toString('base64url')
}

function decodeCursor(value: string | undefined): { name: string; id: string } | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as { n?: unknown; i?: unknown }
    if (typeof parsed.n !== 'string' || typeof parsed.i !== 'string') throw new DomainError('VALIDATION_FAILED')
    return { name: parsed.n, id: parsed.i }
  } catch (error) {
    if (error instanceof DomainError) throw error
    throw new DomainError('VALIDATION_FAILED')
  }
}
