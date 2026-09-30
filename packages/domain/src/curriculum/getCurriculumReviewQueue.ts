import { sql } from 'kysely'
import { DomainError } from '../errors.ts'
import { canReviewQueue, type Db, type Meta } from './support.ts'

export type QueueItem = {
  id: string
  code: string
  title: string
  extraction: string
  reviewStatus: string
  revision: string
  sourceDoc: string
  sourceLocator: string | null
  text: string
}

export type QueueKind = 'requirement' | 'kc' | 'edge' | 'misconception' | 'link'

export async function getCurriculumReviewQueue(
  db: Db,
  meta: Meta,
  input: { kind?: QueueKind; cursor?: string; limit?: number },
): Promise<{ items: QueueItem[]; nextCursor: string | null; counts: Record<QueueKind, number> }> {
  if (!canReviewQueue(meta.actor)) throw new DomainError('FORBIDDEN')
  const kind = input.kind ?? 'requirement'
  const limit = Math.min(input.limit ?? 50, 100)
  const counts = await queueCounts(db)
  if (kind !== 'requirement') {
    const items = await otherQueue(db, kind)
    return { items, nextCursor: null, counts }
  }
  const cursor = decodeCursor(input.cursor)
  let query = db
    .selectFrom('curriculum_requirements')
    .select([
      'id',
      'code791_stem',
      'text',
      'extraction',
      'review_status',
      'source_doc',
      'source_locator',
      sql<number>`CASE WHEN extraction = 'check' THEN 0 ELSE 1 END`.as('bucket'),
      sql<string>`(extract(epoch from updated_at) * 1000000)::bigint::text`.as('revision'),
    ])
    .where('review_status', 'in', ['unverified', 'source_checked'])
  if (cursor) {
    query = query.where((eb) =>
      eb.or([
        eb(sql`CASE WHEN extraction = 'check' THEN 0 ELSE 1 END`, '>', cursor.bucket),
        eb.and([
          eb(sql`CASE WHEN extraction = 'check' THEN 0 ELSE 1 END`, '=', cursor.bucket),
          eb('code791_stem', '>', cursor.code),
        ]),
      ]),
    )
  }
  const rows = await query
    .orderBy(sql`CASE WHEN extraction = 'check' THEN 0 ELSE 1 END`)
    .orderBy('code791_stem')
    .limit(limit + 1)
    .execute()
  const page = rows.slice(0, limit)
  const last = page[page.length - 1]
  const nextCursor = rows.length > limit && last ? encodeCursor(Number(last.bucket), last.code791_stem) : null
  return {
    counts,
    nextCursor,
    items: page.map((row) => ({
      id: row.id,
      code: row.code791_stem,
      title: row.code791_stem,
      extraction: row.extraction,
      reviewStatus: row.review_status,
      revision: row.revision,
      sourceDoc: row.source_doc,
      sourceLocator: row.source_locator,
      text: row.text,
    })),
  }
}

async function queueCounts(db: Db): Promise<Record<QueueKind, number>> {
  const requirements = await db
    .selectFrom('curriculum_requirements')
    .select(sql<number>`count(*)::int`.as('n'))
    .where('review_status', 'in', ['unverified', 'source_checked'])
    .executeTakeFirst()
  const kcs = await db.selectFrom('kc_versions').select(sql<number>`count(*)::int`.as('n')).where('status', '=', 'proposed').executeTakeFirst()
  const edges = await db.selectFrom('kc_edges').select(sql<number>`count(*)::int`.as('n')).where('status', '=', 'proposed').executeTakeFirst()
  const misconceptions = await db
    .selectFrom('misconceptions')
    .select(sql<number>`count(*)::int`.as('n'))
    .where('status', '=', 'proposed')
    .executeTakeFirst()
  const links = await db
    .selectFrom('requirement_kc_links')
    .select(sql<number>`count(*)::int`.as('n'))
    .where('status', '=', 'proposed')
    .executeTakeFirst()
  return {
    requirement: requirements?.n ?? 0,
    kc: kcs?.n ?? 0,
    edge: edges?.n ?? 0,
    misconception: misconceptions?.n ?? 0,
    link: links?.n ?? 0,
  }
}

async function otherQueue(db: Db, kind: QueueKind): Promise<QueueItem[]> {
  if (kind === 'kc') {
    const rows = await db
      .selectFrom('kc_versions')
      .innerJoin('knowledge_components', 'knowledge_components.id', 'kc_versions.kc_id')
      .select(['kc_versions.id', 'knowledge_components.code', 'kc_versions.name', 'kc_versions.status', 'kc_versions.observable_criteria'])
      .where('kc_versions.status', '=', 'proposed')
      .orderBy('knowledge_components.code')
      .execute()
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      title: row.name,
      extraction: 'clean',
      reviewStatus: row.status,
      revision: '',
      sourceDoc: '',
      sourceLocator: null,
      text: row.observable_criteria,
    }))
  }
  if (kind === 'edge') {
    const rows = await sql<{ id: string; from_code: string; to_code: string; from_name: string; to_name: string; status: string }>`
      SELECT e.id, sf.code AS from_code, st.code AS to_code, vf.name AS from_name, vt.name AS to_name, e.status
        FROM kc_edges e
        JOIN kc_versions vf ON vf.id = e.from_kc_version_id
        JOIN kc_versions vt ON vt.id = e.to_kc_version_id
        JOIN knowledge_components sf ON sf.id = vf.kc_id
        JOIN knowledge_components st ON st.id = vt.kc_id
       WHERE e.status = 'proposed'
       ORDER BY sf.code, st.code
    `.execute(db)
    return rows.rows.map((row) => ({
      id: row.id,
      code: `${row.from_code} → ${row.to_code}`,
      title: `${row.from_name} → ${row.to_name}`,
      extraction: 'clean',
      reviewStatus: row.status,
      revision: '',
      sourceDoc: '',
      sourceLocator: null,
      text: `${row.from_code} ${row.from_name} → ${row.to_code} ${row.to_name}`,
    }))
  }
  if (kind === 'misconception') {
    const rows = await db
      .selectFrom('misconceptions')
      .innerJoin('knowledge_components', 'knowledge_components.id', 'misconceptions.kc_id')
      .select(['misconceptions.id', 'misconceptions.code', 'misconceptions.description', 'misconceptions.status', 'knowledge_components.code as kc_code'])
      .where('misconceptions.status', '=', 'proposed')
      .orderBy('misconceptions.code')
      .execute()
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      title: row.kc_code,
      extraction: 'clean',
      reviewStatus: row.status,
      revision: '',
      sourceDoc: '',
      sourceLocator: null,
      text: row.description,
    }))
  }
  const rows = await db
    .selectFrom('requirement_kc_links')
    .innerJoin('curriculum_requirements', 'curriculum_requirements.id', 'requirement_kc_links.requirement_id')
    .innerJoin('kc_versions', 'kc_versions.id', 'requirement_kc_links.kc_version_id')
    .innerJoin('knowledge_components', 'knowledge_components.id', 'kc_versions.kc_id')
    .select(['requirement_kc_links.id', 'curriculum_requirements.code791_stem', 'knowledge_components.code', 'requirement_kc_links.status'])
    .where('requirement_kc_links.status', '=', 'proposed')
    .orderBy('curriculum_requirements.code791_stem')
    .execute()
  return rows.map((row) => ({
    id: row.id,
    code: `${row.code791_stem} · ${row.code}`,
    title: row.code,
    extraction: 'clean',
    reviewStatus: row.status,
    revision: '',
    sourceDoc: '',
    sourceLocator: null,
    text: row.code791_stem,
  }))
}

function encodeCursor(bucket: number, code: string): string {
  return Buffer.from(JSON.stringify({ b: bucket, c: code }), 'utf8').toString('base64url')
}

function decodeCursor(value: string | undefined): { bucket: number; code: string } | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as { b?: unknown; c?: unknown }
    if (typeof parsed.b !== 'number' || typeof parsed.c !== 'string') throw new DomainError('VALIDATION_FAILED')
    return { bucket: parsed.b, code: parsed.c }
  } catch (error) {
    if (error instanceof DomainError) throw error
    throw new DomainError('VALIDATION_FAILED')
  }
}
