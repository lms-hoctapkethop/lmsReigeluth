import { DomainError } from '../errors.ts'
import { assertReviewer, rejectSelfReview, requireReview, reviewAudit, writeReviewLog, type Db, type Meta } from './support.ts'

export async function reviewRequirementKcLink(
  db: Db,
  meta: Meta,
  linkId: string,
  input: { decision: 'approved' | 'rejected' },
): Promise<{ id: string; status: string }> {
  requireReview(meta.actor)
  return db.transaction().execute(async (trx) => {
    const link = await trx.selectFrom('requirement_kc_links').selectAll().where('id', '=', linkId).forUpdate().executeTakeFirst()
    if (!link || link.status !== 'proposed') throw new DomainError('NOT_FOUND')
    const subject = await trx
      .selectFrom('kc_versions')
      .innerJoin('knowledge_components', 'knowledge_components.id', 'kc_versions.kc_id')
      .select(['knowledge_components.subject_code'])
      .where('kc_versions.id', '=', link.kc_version_id)
      .executeTakeFirst()
    if (!subject) throw new DomainError('NOT_FOUND')
    await assertReviewer(trx, meta.actor.userId, [subject.subject_code])
    rejectSelfReview(link.created_by, meta.actor.userId)
    await trx
      .updateTable('requirement_kc_links')
      .set({ status: input.decision, reviewed_by: meta.actor.userId })
      .where('id', '=', link.id)
      .execute()
    await writeReviewLog(trx, {
      entityType: 'requirement_kc_link',
      entityId: link.id,
      action: input.decision,
      actorId: meta.actor.userId,
      fromStatus: link.status,
      toStatus: input.decision,
      note: null,
    })
    await reviewAudit(trx, meta, 'curriculum.link.review', 'requirement_kc_link', link.id, input.decision)
    return { id: link.id, status: input.decision }
  })
}
