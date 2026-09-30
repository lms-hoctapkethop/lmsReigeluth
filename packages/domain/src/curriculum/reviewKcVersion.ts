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

export async function reviewKcVersion(
  db: Db,
  meta: Meta,
  kcVersionId: string,
  input: { decision: 'approved' | 'rejected'; note?: string; dropEdgeIds?: string[]; dropLinkIds?: string[] },
): Promise<{ id: string; status: string }> {
  requireReview(meta.actor)
  const dropEdges = new Set(input.dropEdgeIds ?? [])
  const dropLinks = new Set(input.dropLinkIds ?? [])
  return db.transaction().execute(async (trx) => {
    const version = await trx.selectFrom('kc_versions').selectAll().where('id', '=', kcVersionId).forUpdate().executeTakeFirst()
    if (!version || version.status !== 'proposed') throw new DomainError('NOT_FOUND')
    const kc = await trx.selectFrom('knowledge_components').selectAll().where('id', '=', version.kc_id).executeTakeFirst()
    if (!kc) throw new DomainError('NOT_FOUND')
    await assertReviewer(trx, meta.actor.userId, [kc.subject_code])
    rejectSelfReview(version.created_by, meta.actor.userId)
    if (input.decision === 'approved' && version.version_no > 1) {
      const previous = await trx
        .selectFrom('kc_versions')
        .selectAll()
        .where('kc_id', '=', version.kc_id)
        .where('version_no', '=', version.version_no - 1)
        .executeTakeFirst()
      if (previous) {
        const edges = await trx
          .selectFrom('kc_edges')
          .selectAll()
          .where('status', '=', 'approved')
          .where((eb) => eb.or([eb('from_kc_version_id', '=', previous.id), eb('to_kc_version_id', '=', previous.id)]))
          .execute()
        for (const edge of edges) {
          if (dropEdges.has(edge.id)) continue
          const from = edge.from_kc_version_id === previous.id ? version.id : edge.from_kc_version_id
          const to = edge.to_kc_version_id === previous.id ? version.id : edge.to_kc_version_id
          await withEdgeWrite(trx, async () => {
            await trx
              .insertInto('kc_edges')
              .values({
                from_kc_version_id: from,
                to_kc_version_id: to,
                edge_type: edge.edge_type,
                status: 'approved',
                source: edge.source,
                rationale: edge.rationale,
                reviewed_by: meta.actor.userId,
                created_by: edge.created_by,
              })
              .execute()
          })
        }
        const links = await trx
          .selectFrom('requirement_kc_links')
          .selectAll()
          .where('kc_version_id', '=', previous.id)
          .where('status', '=', 'approved')
          .execute()
        for (const link of links) {
          if (dropLinks.has(link.id)) continue
          await trx
            .insertInto('requirement_kc_links')
            .values({
              requirement_id: link.requirement_id,
              kc_version_id: version.id,
              coverage: link.coverage,
              status: 'approved',
              source: link.source,
              reviewed_by: meta.actor.userId,
              created_by: link.created_by,
            })
            .execute()
        }
        await trx.updateTable('kc_versions').set({ status: 'superseded' }).where('id', '=', previous.id).execute()
      }
    }
    await trx
      .updateTable('kc_versions')
      .set({ status: input.decision, reviewed_by: meta.actor.userId, reviewed_at: new Date() })
      .where('id', '=', version.id)
      .execute()
    await writeReviewLog(trx, {
      entityType: 'kc_version',
      entityId: version.id,
      action: input.decision,
      actorId: meta.actor.userId,
      fromStatus: version.status,
      toStatus: input.decision,
      note: input.note ?? null,
    })
    await reviewAudit(trx, meta, 'curriculum.kc.review', 'kc_version', version.id, input.decision)
    return { id: version.id, status: input.decision }
  })
}
