import { DomainError } from '../errors.ts'
import { audit, outbox, requireGuardian, type Db, type Meta } from './support.ts'
import { assertLinkSchool, readLink, type GuardianLinkDto } from './createGuardianLink.ts'

export async function verifyGuardianLink(db: Db, meta: Meta, linkId: string): Promise<GuardianLinkDto> {
  const link = await readLink(db, linkId)
  assertLinkSchool(link, meta.actor.schoolId)
  requireGuardian(meta.actor, 'guardian_link.verify')
  if (link.status !== 'pending') throw new DomainError('VALIDATION_FAILED')
  const at = meta.clock.now()
  await db.transaction().execute(async (trx) => {
    await trx
      .updateTable('guardian_links')
      .set({ status: 'verified', verified_by: meta.actor.userId, verified_at: at })
      .where('id', '=', linkId)
      .execute()
    await audit(trx, meta, {
      action: 'guardian_link.verify',
      objectType: 'guardian_link',
      objectId: linkId,
      details: { id: linkId, status: 'verified' },
    })
    await outbox(trx, {
      schoolId: meta.actor.schoolId,
      aggregateType: 'guardian_link',
      aggregateId: linkId,
      eventType: 'GuardianLinkVerified',
      payload: { linkId, status: 'verified' },
    })
  })
  const names = await db.selectFrom('users').select(['id', 'display_name']).where('id', 'in', [link.guardian_id, link.learner_id]).execute()
  return {
    id: linkId,
    guardianId: link.guardian_id,
    guardianName: names.find((row) => row.id === link.guardian_id)?.display_name ?? '',
    learnerId: link.learner_id,
    learnerName: names.find((row) => row.id === link.learner_id)?.display_name ?? '',
    relation: link.relation,
    status: 'verified',
  }
}
