import { DomainError } from '../errors.ts'
import type { IdpAdmin } from './idp-admin.ts'
import { audit, outbox, requireOrg, sameSchool, type Db, type Meta } from './support.ts'

async function userInSchool(db: Db, schoolId: string, userId: string): Promise<{ id: string; oidc_subject: string; status: 'active' | 'locked' } | undefined> {
  const row = await db
    .selectFrom('users')
    .innerJoin('school_memberships', 'school_memberships.user_id', 'users.id')
    .select(['users.id as id', 'users.oidc_subject as oidc_subject', 'users.status as status'])
    .where('users.id', '=', userId)
    .where('school_memberships.school_id', '=', schoolId)
    .executeTakeFirst()
  return row
}

export async function lockUser(db: Db, meta: Meta, idp: IdpAdmin, input: { userId: string; reason: string }): Promise<{ id: string; status: 'locked' }> {
  if (input.reason.trim().length < 3) throw new DomainError('VALIDATION_FAILED')
  const user = await userInSchool(db, meta.actor.schoolId, input.userId)
  sameSchool(user ? meta.actor.schoolId : undefined, meta.actor.schoolId)
  requireOrg(meta.actor)
  if (!user) throw new DomainError('NOT_FOUND')
  await idp.setEnabled(user.oidc_subject, false)
  await db.transaction().execute(async (trx) => {
    await trx.updateTable('users').set({ status: 'locked' }).where('id', '=', user.id).execute()
    await audit(trx, meta, {
      action: 'user.lock',
      objectType: 'user',
      objectId: user.id,
      details: { id: user.id, status: 'locked' },
    })
    await outbox(trx, {
      schoolId: meta.actor.schoolId,
      aggregateType: 'user',
      aggregateId: user.id,
      eventType: 'UserLocked',
      payload: { userId: user.id, status: 'locked' },
    })
  })
  return { id: user.id, status: 'locked' }
}
