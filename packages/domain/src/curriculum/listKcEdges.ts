import { sql } from 'kysely'
import { effectivePrerequisites, proposedEdgesForReview } from '@hcn/db'
import { canReviewQueue, requireRead, type Db, type Meta } from './support.ts'
import { DomainError } from '../errors.ts'

export type EdgeDto = {
  id: string
  fromKcVersionId: string
  toKcVersionId: string
  fromCode: string
  toCode: string
  fromName: string
  toName: string
  edgeType: string
  status: string
}

export async function listKcEdges(db: Db, meta: Meta, input: { scope?: 'effective' | 'proposed'; kcVersionId?: string }): Promise<EdgeDto[]> {
  const scope = input.scope ?? 'effective'
  if (scope === 'proposed') {
    if (!canReviewQueue(meta.actor)) throw new DomainError('FORBIDDEN')
    const proposed = await proposedEdgesForReview(db)
    return hydrate(db, proposed.map((row) => row.id))
  }
  requireRead(meta.actor)
  if (input.kcVersionId) {
    const edges = await effectivePrerequisites(db, input.kcVersionId)
    return hydrate(db, edges.map((row) => row.id))
  }
  const rows = await sql<{ id: string }>`SELECT id FROM effective_kc_edges ORDER BY from_kc_version_id, to_kc_version_id`.execute(db)
  return hydrate(db, rows.rows.map((row) => row.id))
}

async function hydrate(db: Db, ids: string[]): Promise<EdgeDto[]> {
  if (ids.length === 0) return []
  const rows = await db
    .selectFrom('kc_edges as e')
    .innerJoin('kc_versions as vf', 'vf.id', 'e.from_kc_version_id')
    .innerJoin('kc_versions as vt', 'vt.id', 'e.to_kc_version_id')
    .innerJoin('knowledge_components as sf', 'sf.id', 'vf.kc_id')
    .innerJoin('knowledge_components as st', 'st.id', 'vt.kc_id')
    .select([
      'e.id',
      'e.from_kc_version_id',
      'e.to_kc_version_id',
      'sf.code as fromCode',
      'st.code as toCode',
      'vf.name as fromName',
      'vt.name as toName',
      'e.edge_type',
      'e.status',
    ])
    .where('e.id', 'in', ids)
    .execute()
  return rows.map((row) => ({
    id: row.id,
    fromKcVersionId: row.from_kc_version_id,
    toKcVersionId: row.to_kc_version_id,
    fromCode: row.fromCode,
    toCode: row.toCode,
    fromName: row.fromName,
    toName: row.toName,
    edgeType: row.edge_type,
    status: row.status,
  }))
}
