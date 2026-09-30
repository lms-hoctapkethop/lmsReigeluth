import { DomainError } from '../errors.ts'
import { pgCode } from '../org/support.ts'
import { requirePropose, reviewAudit, writeReviewLog, type Db, type Meta } from './support.ts'

export async function proposeKcEdge(
  db: Db,
  meta: Meta,
  input: { fromKcVersionId: string; toKcVersionId: string; edgeType: 'prerequisite' | 'develops_into' | 'part_of'; rationale?: string },
): Promise<{ id: string; status: string }> {
  requirePropose(meta.actor)
  if (input.fromKcVersionId === input.toKcVersionId) throw new DomainError('VALIDATION_FAILED', { reason: 'SELF_EDGE' })
  try {
    return await db.transaction().execute(async (trx) => {
      const row = await trx
        .insertInto('kc_edges')
        .values({
          from_kc_version_id: input.fromKcVersionId,
          to_kc_version_id: input.toKcVersionId,
          edge_type: input.edgeType,
          status: 'proposed',
          source: 'teacher',
          rationale: input.rationale ?? null,
          reviewed_by: null,
          created_by: meta.actor.userId,
        })
        .returning(['id'])
        .executeTakeFirstOrThrow()
      await writeReviewLog(trx, {
        entityType: 'kc_edge',
        entityId: row.id,
        action: 'proposed',
        actorId: meta.actor.userId,
        fromStatus: null,
        toStatus: 'proposed',
        note: null,
      })
      await reviewAudit(trx, meta, 'curriculum.edge.propose', 'kc_edge', row.id, 'proposed')
      return { id: row.id, status: 'proposed' }
    })
  } catch (error) {
    if (pgCode(error) === '23503') throw new DomainError('NOT_FOUND')
    if (pgCode(error) === '23505') throw new DomainError('REVISION_CONFLICT')
    throw error
  }
}
