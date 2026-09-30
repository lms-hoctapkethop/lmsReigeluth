import { randomUUID } from 'node:crypto'
import { DomainError } from '../errors.ts'
import type { IdpAdmin } from './idp-admin.ts'
import { audit, outbox, pgCode, type Db } from './support.ts'

export async function bootstrapSchool(
  db: Db,
  idp: IdpAdmin,
  input: { name: string; code: string; adminUsername: string; issuer: string; requestId: string },
): Promise<{ schoolId: string; userId: string; created: boolean }> {
  if (!/^[A-Z0-9_-]{2,32}$/.test(input.code) || input.name.trim().length === 0) throw new DomainError('VALIDATION_FAILED')
  const account = await idp.findByUsername(input.adminUsername)
  if (!account) throw new DomainError('NOT_FOUND')
  const existingSchool = await db.selectFrom('schools').select(['id']).where('code', '=', input.code).executeTakeFirst()
  let schoolId = existingSchool?.id
  let created = false
  if (!schoolId) {
    schoolId = randomUUID()
    try {
      await db.insertInto('schools').values({ id: schoolId, code: input.code, name: input.name.trim() }).execute()
      created = true
    } catch (error) {
      if (pgCode(error) !== '23505') throw error
      const again = await db.selectFrom('schools').select(['id']).where('code', '=', input.code).executeTakeFirst()
      if (!again) throw error
      schoolId = again.id
    }
  }
  const existingUser = await db
    .selectFrom('users')
    .select(['id'])
    .where('oidc_issuer', '=', input.issuer)
    .where('oidc_subject', '=', account.id)
    .executeTakeFirst()
  const userId = existingUser?.id ?? account.id
  if (!existingUser) {
    await db
      .insertInto('users')
      .values({
        id: userId,
        oidc_issuer: input.issuer,
        oidc_subject: account.id,
        display_name: input.adminUsername,
        email: null,
        status: 'active',
      })
      .execute()
  }
  const membership = await db
    .selectFrom('school_memberships')
    .select(['id'])
    .where('school_id', '=', schoolId)
    .where('user_id', '=', userId)
    .where('role', '=', 'admin')
    .executeTakeFirst()
  const membershipCreated = !membership
  if (membershipCreated) {
    await db
      .insertInto('school_memberships')
      .values({ school_id: schoolId, user_id: userId, role: 'admin', status: 'active' })
      .execute()
  }
  if (created || !existingUser || membershipCreated) {
    const meta = { actor: { userId, schoolId, roles: ['admin' as const] }, requestId: input.requestId, clock: { now: () => new Date() } }
    await db.transaction().execute(async (trx) => {
      await audit(trx, meta, {
        action: 'school.bootstrap',
        objectType: 'school',
        objectId: schoolId,
        details: { id: schoolId, userId, status: created ? 'created' : 'exists' },
      })
      await outbox(trx, {
        schoolId,
        aggregateType: 'school',
        aggregateId: schoolId,
        eventType: 'SchoolBootstrapped',
        payload: { schoolId, userId, status: created ? 'created' : 'exists' },
      })
    })
  }
  return { schoolId, userId, created }
}
