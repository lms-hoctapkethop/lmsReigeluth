import { DomainError } from '../errors.ts'
import { assertReviewer, rejectSelfReview, requireReview, reviewAudit, writeReviewLog, type Db, type Meta } from './support.ts'

export async function reviewMisconception(
  db: Db,
  meta: Meta,
  misconceptionId: string,
  input: { decision: 'approved' | 'rejected' },
): Promise<{ id: string; status: string }> {
  requireReview(meta.actor)
  return db.transaction().execute(async (trx) => {
    const row = await trx.selectFrom('misconceptions').selectAll().where('id', '=', misconceptionId).forUpdate().executeTakeFirst()
    if (!row || row.status !== 'proposed') throw new DomainError('NOT_FOUND')
    const kc = await trx.selectFrom('knowledge_components').select(['subject_code']).where('id', '=', row.kc_id).executeTakeFirst()
    if (!kc) throw new DomainError('NOT_FOUND')
    await assertReviewer(trx, meta.actor.userId, [kc.subject_code])
    rejectSelfReview(row.created_by, meta.actor.userId)
    await trx
      .updateTable('misconceptions')
      .set({ status: input.decision, reviewed_by: meta.actor.userId })
      .where('id', '=', row.id)
      .execute()
    await writeReviewLog(trx, {
      entityType: 'misconception',
      entityId: row.id,
      action: input.decision,
      actorId: meta.actor.userId,
      fromStatus: row.status,
      toStatus: input.decision,
      note: null,
    })
    await reviewAudit(trx, meta, 'curriculum.misconception.review', 'misconception', row.id, input.decision)
    return { id: row.id, status: input.decision }
  })
}
