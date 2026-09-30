import { requireRead, type Db, type Meta } from './support.ts'

export async function listMisconceptions(db: Db, meta: Meta, input: { kcId?: string; status?: string }) {
  requireRead(meta.actor)
  let query = db
    .selectFrom('misconceptions')
    .innerJoin('knowledge_components', 'knowledge_components.id', 'misconceptions.kc_id')
    .select([
      'misconceptions.id',
      'misconceptions.code',
      'misconceptions.description',
      'misconceptions.status',
      'knowledge_components.code as kcCode',
    ])
  if (input.kcId) query = query.where('misconceptions.kc_id', '=', input.kcId)
  if (input.status === 'proposed' || input.status === 'approved' || input.status === 'rejected') {
    query = query.where('misconceptions.status', '=', input.status)
  }
  const rows = await query.orderBy('misconceptions.code').execute()
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    description: row.description,
    status: row.status,
    kcCode: row.kcCode,
  }))
}
