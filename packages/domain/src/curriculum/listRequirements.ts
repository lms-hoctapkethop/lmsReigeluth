import { sql } from 'kysely'
import { requireRead, type Db, type Meta } from './support.ts'

export type RequirementDto = {
  id: string
  code791Stem: string
  text: string
  subjectCode: string
  grade: number
  sourceDoc: string
  sourceLocator: string | null
  extraction: string
  reviewStatus: string
  revision: string
}

export async function listRequirements(
  db: Db,
  meta: Meta,
  input: { subject: string; grade: number; q?: string },
): Promise<RequirementDto[]> {
  requireRead(meta.actor)
  const role = meta.actor.roles[0]
  let query = db
    .selectFrom('curriculum_requirements')
    .select([
      'id',
      'code791_stem',
      'text',
      'subject_code',
      'grade',
      'source_doc',
      'source_locator',
      'extraction',
      'review_status',
      sql<string>`(extract(epoch from updated_at) * 1000000)::bigint::text`.as('revision'),
    ])
    .where('subject_code', '=', input.subject)
    .where('grade', '=', input.grade)
  if (role === 'student' || role === 'guardian') {
    query = query.where('review_status', 'in', ['approved', 'source_checked'])
  }
  if (input.q) query = query.where('text', 'ilike', `%${input.q}%`)
  const rows = await query.orderBy('code791_stem').execute()
  return rows.map((row) => ({
    id: row.id,
    code791Stem: row.code791_stem,
    text: row.text,
    subjectCode: row.subject_code,
    grade: row.grade,
    sourceDoc: row.source_doc,
    sourceLocator: row.source_locator,
    extraction: row.extraction,
    reviewStatus: row.review_status,
    revision: row.revision,
  }))
}
