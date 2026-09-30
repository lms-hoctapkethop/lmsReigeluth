import { DomainError } from '../errors.ts'
import type { IdpAdmin } from './idp-admin.ts'
import { audit, outbox, requireOrg, type Db, type Meta } from './support.ts'

export async function unlockUser(db: Db, meta: Meta, idp: IdpAdmin, input: { userId: string; reason: string }): Promise<{ id: string; status: 'active' }> {
  if (input.reason.trim().length < 3) throw new DomainError('VALIDATION_FAILED')
  const user = await db
    .selectFrom('users')
    .innerJoin('school_memberships', 'school_memberships.user_id', 'users.id')
    .select(['users.id as id', 'users.oidc_subject as oidc_subject'])
    .where('users.id', '=', input.userId)
    .where('school_memberships.school_id', '=', meta.actor.schoolId)
    .executeTakeFirst()
  if (!user) throw new DomainError('NOT_FOUND')
  requireOrg(meta.actor)
  await idp.setEnabled(user.oidc_subject, true)
  await db.transaction().execute(async (trx) => {
    await trx.updateTable('users').set({ status: 'active' }).where('id', '=', user.id).execute()
    await audit(trx, meta, {
      action: 'user.unlock',
      objectType: 'user',
      objectId: user.id,
      details: { id: user.id, status: 'active' },
    })
    await outbox(trx, {
      schoolId: meta.actor.schoolId,
      aggregateType: 'user',
      aggregateId: user.id,
      eventType: 'UserUnlocked',
      payload: { userId: user.id, status: 'active' },
    })
  })
  return { id: user.id, status: 'active' }
}
