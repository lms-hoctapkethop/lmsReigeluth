import { DomainError } from '../errors.ts'
import { audit, outbox, requireGuardian, type Db, type Meta } from './support.ts'
import { assertLinkSchool, readLink, type GuardianLinkDto } from './createGuardianLink.ts'

export async function revokeGuardianLink(db: Db, meta: Meta, input: { linkId: string; reason: string }): Promise<GuardianLinkDto> {
  const link = await readLink(db, input.linkId)
  assertLinkSchool(link, meta.actor.schoolId)
  requireGuardian(meta.actor, 'guardian_link.revoke')
  if (input.reason.trim().length < 3) throw new DomainError('VALIDATION_FAILED')
  if (link.status !== 'pending' && link.status !== 'verified') throw new DomainError('VALIDATION_FAILED')
  const at = meta.clock.now()
  await db.transaction().execute(async (trx) => {
    await trx
      .updateTable('guardian_links')
      .set({ status: 'revoked', revoked_by: meta.actor.userId, revoked_at: at, revoke_reason: input.reason.trim() })
      .where('id', '=', input.linkId)
      .execute()
    await audit(trx, meta, {
      action: 'guardian_link.revoke',
      objectType: 'guardian_link',
      objectId: input.linkId,
      details: { id: input.linkId, status: 'revoked' },
    })
    await outbox(trx, {
      schoolId: meta.actor.schoolId,
      aggregateType: 'guardian_link',
      aggregateId: input.linkId,
      eventType: 'GuardianLinkRevoked',
      payload: { linkId: input.linkId, status: 'revoked' },
    })
  })
  const names = await db.selectFrom('users').select(['id', 'display_name']).where('id', 'in', [link.guardian_id, link.learner_id]).execute()
  return {
    id: input.linkId,
    guardianId: link.guardian_id,
    guardianName: names.find((row) => row.id === link.guardian_id)?.display_name ?? '',
    learnerId: link.learner_id,
    learnerName: names.find((row) => row.id === link.learner_id)?.display_name ?? '',
    relation: link.relation,
    status: 'revoked',
  }
}
