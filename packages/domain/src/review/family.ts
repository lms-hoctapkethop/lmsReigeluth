import { DomainError } from '../errors.ts'
import { requestDigest } from '../authoring/digest.ts'
import { withIdempotency } from '../idempotency.ts'
import { authorize } from '../identity/policies.ts'
import { audit, pgCode, type Db, type Meta } from '../org/support.ts'

export async function commitFamilySupport(
  db: Db,
  meta: Meta,
  input: { learnerId: string; offeringId?: string; content: string; idempotencyKey: string },
): Promise<{ id: string; status: 'committed'; createdAt: string }> {
  const content = input.content.trim()
  if (content.length < 3 || content.length > 500) throw new DomainError('VALIDATION_FAILED', { reason: 'CONTENT' })
  return withIdempotency(db, meta, {
    scope: `commitFamilySupport:${input.learnerId}`,
    key: input.idempotencyKey,
    requestHash: requestDigest({ learnerId: input.learnerId, offeringId: input.offeringId ?? null, content }),
    run: async (trx) => {
      if (!meta.actor.roles.includes('guardian')) throw new DomainError('NOT_FOUND')
      const link = await trx
        .selectFrom('guardian_links')
        .select(['id', 'school_id'])
        .where('guardian_id', '=', meta.actor.userId)
        .where('learner_id', '=', input.learnerId)
        .where('status', '=', 'verified')
        .executeTakeFirst()
      if (!link || link.school_id !== meta.actor.schoolId) throw new DomainError('NOT_FOUND')
      authorize(meta.actor, 'family_support.*', { guardianLinked: true })
      if (input.offeringId) {
        const enrolled = await trx
          .selectFrom('offering_enrollments')
          .select('id')
          .where('learner_id', '=', input.learnerId)
          .where('offering_id', '=', input.offeringId)
          .where('school_id', '=', meta.actor.schoolId)
          .where('status', '=', 'active')
          .executeTakeFirst()
        if (!enrolled) throw new DomainError('NOT_FOUND')
      }
      const created = await trx
        .insertInto('family_supports')
        .values({
          school_id: meta.actor.schoolId,
          guardian_link_id: link.id,
          offering_id: input.offeringId ?? null,
          content,
        })
        .returning(['id', 'created_at'])
        .executeTakeFirstOrThrow()
      await audit(trx, meta, {
        action: 'family_support.commit',
        objectType: 'family_support',
        objectId: created.id,
        details: { learnerId: input.learnerId },
      })
      return { id: created.id, status: 'committed' as const, createdAt: created.created_at.toISOString() }
    },
  })
}

export async function cancelFamilySupport(db: Db, meta: Meta, supportId: string): Promise<{ id: string; status: 'cancelled' }> {
  if (!meta.actor.roles.includes('guardian')) throw new DomainError('NOT_FOUND')
  const row = await db
    .selectFrom('family_supports')
    .innerJoin('guardian_links', 'guardian_links.id', 'family_supports.guardian_link_id')
    .select(['family_supports.id', 'family_supports.status', 'family_supports.school_id', 'guardian_links.guardian_id'])
    .where('family_supports.id', '=', supportId)
    .executeTakeFirst()
  if (!row || row.school_id !== meta.actor.schoolId || row.guardian_id !== meta.actor.userId) throw new DomainError('NOT_FOUND')
  authorize(meta.actor, 'family_support.*', { guardianLinked: true })
  if (row.status !== 'committed') throw new DomainError('VALIDATION_FAILED', { reason: 'ALREADY_CANCELLED' })
  try {
    await db
      .updateTable('family_supports')
      .set({ status: 'cancelled', cancelled_at: meta.clock.now() })
      .where('id', '=', supportId)
      .where('status', '=', 'committed')
      .execute()
  } catch (error) {
    if (pgCode(error) === '23514') throw new DomainError('VALIDATION_FAILED', { reason: 'ALREADY_CANCELLED' })
    throw error
  }
  return { id: supportId, status: 'cancelled' }
}
