import { DomainError } from '../errors.ts'
import { requirePropose, reviewAudit, writeReviewLog, type Db, type Meta } from './support.ts'

export async function proposeKcVersion(
  db: Db,
  meta: Meta,
  input: { kcId: string; name: string; description?: string; observableCriteria: string },
): Promise<{ id: string; kcId: string; versionNo: number; status: string }> {
  requirePropose(meta.actor)
  return db.transaction().execute(async (trx) => {
    const kc = await trx.selectFrom('knowledge_components').select(['id']).where('id', '=', input.kcId).executeTakeFirst()
    if (!kc) throw new DomainError('NOT_FOUND')
    const latest = await trx
      .selectFrom('kc_versions')
      .select(['version_no'])
      .where('kc_id', '=', input.kcId)
      .orderBy('version_no', 'desc')
      .executeTakeFirst()
    const versionNo = (latest?.version_no ?? 0) + 1
    const version = await trx
      .insertInto('kc_versions')
      .values({
        kc_id: input.kcId,
        version_no: versionNo,
        name: input.name,
        description: input.description ?? null,
        observable_criteria: input.observableCriteria,
        status: 'proposed',
        source: 'teacher',
        ai_proposal_id: null,
        created_by: meta.actor.userId,
        reviewed_by: null,
        reviewed_at: null,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow()
    await writeReviewLog(trx, { entityType: 'kc_version', entityId: version.id, action: 'proposed', actorId: meta.actor.userId })
    await reviewAudit(trx, meta, 'curriculum.kc.propose_version', 'kc_version', version.id, 'proposed')
    return { id: version.id, kcId: input.kcId, versionNo, status: 'proposed' }
  })
}
