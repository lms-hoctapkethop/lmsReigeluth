import { DomainError } from '../errors.ts'
import { audit, type Db, type Meta } from '../org/support.ts'

export async function grantReviewer(db: Db, meta: Meta, input: { userId: string; subjectCode: string }): Promise<{ granted: boolean }> {
  if (input.subjectCode !== '1401' && input.subjectCode !== '0201') throw new DomainError('VALIDATION_FAILED', { reason: 'BAD_SUBJECT' })
  const user = await db.selectFrom('users').select(['id']).where('id', '=', input.userId).executeTakeFirst()
  if (!user) throw new DomainError('NOT_FOUND')
  const existing = await db
    .selectFrom('curriculum_reviewers')
    .select(['user_id'])
    .where('user_id', '=', input.userId)
    .where('subject_code', '=', input.subjectCode)
    .executeTakeFirst()
  if (existing) return { granted: false }
  await db.transaction().execute(async (trx) => {
    await trx
      .insertInto('curriculum_reviewers')
      .values({ user_id: input.userId, subject_code: input.subjectCode, granted_by: meta.actor.userId })
      .execute()
    await audit(trx, meta, {
      action: 'curriculum.reviewer.grant',
      objectType: 'curriculum_reviewer',
      objectId: input.userId,
      details: { subject: input.subjectCode, status: 'granted' },
    })
  })
  return { granted: true }
}

export async function revokeReviewer(db: Db, meta: Meta, input: { userId: string; subjectCode: string }): Promise<{ revoked: boolean }> {
  if (input.subjectCode !== '1401' && input.subjectCode !== '0201') throw new DomainError('VALIDATION_FAILED', { reason: 'BAD_SUBJECT' })
  return db.transaction().execute(async (trx) => {
    const removed = await trx
      .deleteFrom('curriculum_reviewers')
      .where('user_id', '=', input.userId)
      .where('subject_code', '=', input.subjectCode)
      .returning(['user_id'])
      .executeTakeFirst()
    if (!removed) return { revoked: false }
    await audit(trx, meta, {
      action: 'curriculum.reviewer.revoke',
      objectType: 'curriculum_reviewer',
      objectId: input.userId,
      details: { subject: input.subjectCode, status: 'revoked' },
    })
    return { revoked: true }
  })
}
