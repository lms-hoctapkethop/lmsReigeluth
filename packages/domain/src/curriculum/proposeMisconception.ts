import { DomainError } from '../errors.ts'
import { pgCode } from '../org/support.ts'
import { requirePropose, reviewAudit, writeReviewLog, type Db, type Meta } from './support.ts'

export async function proposeMisconception(
  db: Db,
  meta: Meta,
  input: { code: string; kcId: string; description: string },
): Promise<{ id: string; code: string; status: string }> {
  requirePropose(meta.actor)
  try {
    return await db.transaction().execute(async (trx) => {
      const row = await trx
        .insertInto('misconceptions')
        .values({
          code: input.code,
          kc_id: input.kcId,
          description: input.description,
          status: 'proposed',
          reviewed_by: null,
          created_by: meta.actor.userId,
        })
        .returning(['id', 'code'])
        .executeTakeFirstOrThrow()
      await writeReviewLog(trx, { entityType: 'misconception', entityId: row.id, action: 'proposed', actorId: meta.actor.userId })
      await reviewAudit(trx, meta, 'curriculum.misconception.propose', 'misconception', row.id, 'proposed')
      return { id: row.id, code: row.code, status: 'proposed' }
    })
  } catch (error) {
    if (pgCode(error) === '23503') throw new DomainError('NOT_FOUND')
    if (pgCode(error) === '23505') throw new DomainError('REVISION_CONFLICT')
    throw error
  }
}
