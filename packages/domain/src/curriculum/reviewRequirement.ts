import { sql } from 'kysely'
import { DomainError } from '../errors.ts'
import {
  assertReviewer,
  parseRevision,
  requireReview,
  reviewAudit,
  writeReviewLog,
  type Db,
  type Meta,
} from './support.ts'

const nextStatus: Record<string, string[]> = {
  unverified: ['source_checked', 'rejected'],
  source_checked: ['approved', 'rejected'],
}

export async function reviewRequirement(
  db: Db,
  meta: Meta,
  requirementId: string,
  input: { decision: string; note?: string; correctedText?: string; ifMatch: string | undefined },
): Promise<{ id: string; reviewStatus: string; revision: string }> {
  requireReview(meta.actor)
  const revision = parseRevision(input.ifMatch)
  return db.transaction().execute(async (trx) => {
    const row = await trx
      .selectFrom('curriculum_requirements')
      .selectAll()
      .where('id', '=', requirementId)
      .forUpdate()
      .executeTakeFirst()
    if (!row) throw new DomainError('NOT_FOUND')
    const current = await sql<{ revision: string }>`
      SELECT (extract(epoch from updated_at) * 1000000)::bigint::text AS revision
        FROM curriculum_requirements WHERE id = ${requirementId}
    `.execute(trx)
    if (current.rows[0]?.revision !== revision) throw new DomainError('REVISION_CONFLICT')
    await assertReviewer(trx, meta.actor.userId, [row.subject_code])
    if (row.review_status === 'approved' || row.review_status === 'rejected') {
      throw new DomainError('VALIDATION_FAILED', { reason: 'ALREADY_APPROVED' })
    }
    const allowed = nextStatus[row.review_status] ?? []
    if (!allowed.includes(input.decision)) throw new DomainError('VALIDATION_FAILED', { reason: 'BAD_TRANSITION' })
    if (row.extraction === 'check' && input.decision === 'source_checked' && !input.note?.trim()) {
      throw new DomainError('VALIDATION_FAILED', { reason: 'NOTE_REQUIRED' })
    }
    const text = input.correctedText ?? row.text
    await trx
      .updateTable('curriculum_requirements')
      .set({
        review_status: input.decision as 'source_checked' | 'approved' | 'rejected',
        text,
        reviewed_by: meta.actor.userId,
        reviewed_at: new Date(),
      })
      .where('id', '=', requirementId)
      .execute()
    await writeReviewLog(trx, {
      entityType: 'requirement',
      entityId: requirementId,
      action: input.decision,
      actorId: meta.actor.userId,
      fromStatus: row.review_status,
      toStatus: input.decision,
      oldText: input.correctedText ? row.text : null,
      newText: input.correctedText ?? null,
      note: input.note ?? null,
    })
    await reviewAudit(trx, meta, 'curriculum.requirement.review', 'curriculum_requirement', requirementId, input.decision)
    const next = await sql<{ revision: string }>`
      SELECT (extract(epoch from updated_at) * 1000000)::bigint::text AS revision
        FROM curriculum_requirements WHERE id = ${requirementId}
    `.execute(trx)
    return { id: requirementId, reviewStatus: input.decision, revision: next.rows[0]?.revision ?? revision }
  })
}
