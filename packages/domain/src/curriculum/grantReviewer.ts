import { DomainError } from '../errors.ts'
import { writeAudit } from '../identity/audit.ts'
import { type Db, type Meta } from '../org/support.ts'

function assertSubject(subjectCode: string): void {
  if (subjectCode !== '1401' && subjectCode !== '0201') throw new DomainError('VALIDATION_FAILED', { reason: 'BAD_SUBJECT' })
}

async function auditCli(
  db: Parameters<typeof writeAudit>[0],
  meta: Meta,
  action: string,
  userId: string,
  osUser: string,
): Promise<void> {
  await writeAudit(db, {
    schoolId: null,
    actorId: null,
    action,
    objectType: 'curriculum_reviewer',
    objectId: userId,
    requestId: meta.requestId,
    details: { via: 'cli', os_user: osUser },
  })
}

export async function grantReviewer(
  db: Db,
  meta: Meta,
  input: { userId: string; subjectCode: string; grantedBy: string; osUser: string },
): Promise<{ granted: boolean }> {
  assertSubject(input.subjectCode)
  const user = await db.selectFrom('users').select(['id']).where('id', '=', input.userId).executeTakeFirst()
  const granter = await db.selectFrom('users').select(['id']).where('id', '=', input.grantedBy).executeTakeFirst()
  if (!user || !granter) throw new DomainError('NOT_FOUND')
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
      .values({ user_id: input.userId, subject_code: input.subjectCode, granted_by: input.grantedBy })
      .execute()
    await auditCli(trx, meta, 'curriculum.reviewer.grant', input.userId, input.osUser)
  })
  return { granted: true }
}

export async function revokeReviewer(
  db: Db,
  meta: Meta,
  input: { userId: string; subjectCode: string; osUser: string },
): Promise<{ revoked: boolean }> {
  assertSubject(input.subjectCode)
  return db.transaction().execute(async (trx) => {
    const removed = await trx
      .deleteFrom('curriculum_reviewers')
      .where('user_id', '=', input.userId)
      .where('subject_code', '=', input.subjectCode)
      .returning(['user_id'])
      .executeTakeFirst()
    if (!removed) return { revoked: false }
    await auditCli(trx, meta, 'curriculum.reviewer.revoke', input.userId, input.osUser)
    return { revoked: true }
  })
}
