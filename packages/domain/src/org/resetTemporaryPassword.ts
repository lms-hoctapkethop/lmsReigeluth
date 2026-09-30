import { DomainError } from '../errors.ts'
import type { IdpAdmin } from './idp-admin.ts'
import { temporaryPassword } from './temporary-password.ts'
import { audit, outbox, requireOrg, type Db, type Meta } from './support.ts'

export async function resetTemporaryPassword(
  db: Db,
  meta: Meta,
  idp: IdpAdmin,
  userId: string,
): Promise<{ userId: string; temporaryPassword: string }> {
  const user = await db
    .selectFrom('users')
    .innerJoin('school_memberships', 'school_memberships.user_id', 'users.id')
    .select(['users.id as id', 'users.oidc_subject as oidc_subject'])
    .where('users.id', '=', userId)
    .where('school_memberships.school_id', '=', meta.actor.schoolId)
    .executeTakeFirst()
  if (!user) throw new DomainError('NOT_FOUND')
  requireOrg(meta.actor)
  const password = temporaryPassword()
  await idp.resetTemporaryPassword(user.oidc_subject, password)
  await db.transaction().execute(async (trx) => {
    await audit(trx, meta, {
      action: 'user.reset_password',
      objectType: 'user',
      objectId: user.id,
      details: { id: user.id, status: 'reset' },
    })
    await outbox(trx, {
      schoolId: meta.actor.schoolId,
      aggregateType: 'user',
      aggregateId: user.id,
      eventType: 'UserPasswordReset',
      payload: { userId: user.id, status: 'reset' },
    })
  })
  return { userId: user.id, temporaryPassword: password }
}
