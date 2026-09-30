import { DomainError } from '../errors.ts'
import {
  assertReviewer,
  rejectSelfReview,
  requireReview,
  reviewAudit,
  withEdgeWrite,
  writeReviewLog,
  type Db,
  type Meta,
} from './support.ts'

export async function reviewKcEdge(
  db: Db,
  meta: Meta,
  edgeId: string,
  input: { decision: 'approved' | 'rejected' },
): Promise<{ id: string; status: string }> {
  requireReview(meta.actor)
  return db.transaction().execute(async (trx) => {
    const edge = await trx.selectFrom('kc_edges').selectAll().where('id', '=', edgeId).forUpdate().executeTakeFirst()
    if (!edge || edge.status !== 'proposed') throw new DomainError('NOT_FOUND')
    const versions = await trx
      .selectFrom('kc_versions')
      .innerJoin('knowledge_components', 'knowledge_components.id', 'kc_versions.kc_id')
      .select(['kc_versions.id', 'knowledge_components.subject_code'])
      .where('kc_versions.id', 'in', [edge.from_kc_version_id, edge.to_kc_version_id])
      .execute()
    await assertReviewer(trx, meta.actor.userId, versions.map((row) => row.subject_code))
    rejectSelfReview(edge.created_by, meta.actor.userId)
    if (input.decision === 'approved') {
      await withEdgeWrite(trx, async () => {
        await trx
          .updateTable('kc_edges')
          .set({ status: 'approved', reviewed_by: meta.actor.userId })
          .where('id', '=', edge.id)
          .execute()
      })
    } else {
      await trx.updateTable('kc_edges').set({ status: 'rejected', reviewed_by: meta.actor.userId }).where('id', '=', edge.id).execute()
    }
    await writeReviewLog(trx, { entityType: 'kc_edge', entityId: edge.id, action: input.decision, actorId: meta.actor.userId })
    await reviewAudit(trx, meta, 'curriculum.edge.review', 'kc_edge', edge.id, input.decision)
    return { id: edge.id, status: input.decision }
  })
}
