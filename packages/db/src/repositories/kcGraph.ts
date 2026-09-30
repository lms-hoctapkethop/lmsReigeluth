import { sql, type Kysely } from 'kysely'
import type { Database } from '../schema.ts'

export type KcEdgeRow = {
  id: string
  fromKcVersionId: string
  toKcVersionId: string
  edgeType: string
}

type Db = Kysely<Database>

function mapEdge(row: { id: string; from_kc_version_id: string; to_kc_version_id: string; edge_type: string }): KcEdgeRow {
  return {
    id: row.id,
    fromKcVersionId: row.from_kc_version_id,
    toKcVersionId: row.to_kc_version_id,
    edgeType: row.edge_type,
  }
}

/** Cạnh đã duyệt trên version còn approved. Dùng cho publish, R0, lộ trình, bản đồ nhiệt. */
export async function effectivePrerequisites(db: Db, kcVersionId: string): Promise<KcEdgeRow[]> {
  const rows = await sql<{ id: string; from_kc_version_id: string; to_kc_version_id: string; edge_type: string }>`
    SELECT id, from_kc_version_id, to_kc_version_id, edge_type
      FROM effective_kc_edges
     WHERE to_kc_version_id = ${kcVersionId}
     ORDER BY from_kc_version_id
  `.execute(db)
  return rows.rows.map(mapEdge)
}

/** Cạnh proposed. Chỉ màn chuyên môn được gọi hàm này. */
export async function proposedEdgesForReview(db: Db): Promise<KcEdgeRow[]> {
  const rows = await db
    .selectFrom('kc_edges')
    .select(['id', 'from_kc_version_id', 'to_kc_version_id', 'edge_type'])
    .where('status', '=', 'proposed')
    .orderBy('created_at')
    .execute()
  return rows.map(mapEdge)
}
