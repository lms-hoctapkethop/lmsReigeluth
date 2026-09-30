import { createHash, randomBytes } from 'node:crypto'
import { sql, type Kysely } from 'kysely'
import type { Database, Role } from '@hcn/db'
import { writeAudit } from './audit.ts'
import { chooseContext } from './context.ts'
import { listActiveMemberships } from './memberships.ts'

export type EstablishedSession = {
  kind: 'ok'
  token: string
  csrfToken: string
  userId: string
  displayName: string
  schoolId: string
  role: Role
  returnTo: string
}

export type DeniedLogin = { kind: 'denied' }
export type LockedLogin = { kind: 'locked' }

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export async function establishSession(
  db: Kysely<Database>,
  input: {
    issuer: string
    subject: string
    idToken: string
    previousSessionHash: string | null
    ttlHours: number
    maxDays: number
    requestId: string
    returnTo: string
  },
): Promise<EstablishedSession | DeniedLogin | LockedLogin> {
  const user = await db
    .selectFrom('users')
    .select(['id', 'display_name', 'status'])
    .where('oidc_issuer', '=', input.issuer)
    .where('oidc_subject', '=', input.subject)
    .executeTakeFirst()

  const memberships = user ? await listActiveMemberships(db, user.id) : []
  const chosen = chooseContext(memberships)

  return db.transaction().execute(async (trx) => {
    if (input.previousSessionHash) {
      await trx
        .updateTable('sessions')
        .set({ revoked_at: sql`now()` })
        .where('id_hash', '=', input.previousSessionHash)
        .where('revoked_at', 'is', null)
        .execute()
    }

    if (!user || !chosen) {
      await writeAudit(trx, {
        schoolId: null,
        actorId: user?.id ?? null,
        action: 'login_denied_not_provisioned',
        objectType: 'user',
        objectId: user?.id ?? input.subject,
        requestId: input.requestId,
        details: user ? { userId: user.id } : { subject: input.subject },
      })
      return { kind: 'denied' }
    }

    if (user.status === 'locked') return { kind: 'locked' }

    const token = randomBytes(32).toString('base64url')
    const csrfToken = randomBytes(32).toString('base64url')
    await trx
      .insertInto('sessions')
      .values({
        id_hash: sha256(token),
        user_id: user.id,
        csrf_token: csrfToken,
        context: { school_id: chosen.schoolId, role: chosen.role },
        id_token_hint: input.idToken,
        created_at: sql<Date>`now()`,
        last_seen_at: sql<Date>`now()`,
        expires_at: sql<Date>`LEAST(now() + make_interval(hours => ${input.ttlHours}), now() + make_interval(days => ${input.maxDays}))`,
        revoked_at: null,
      })
      .execute()
    await writeAudit(trx, {
      schoolId: chosen.schoolId,
      actorId: user.id,
      action: 'login_succeeded',
      objectType: 'user',
      objectId: user.id,
      requestId: input.requestId,
      details: { userId: user.id, schoolId: chosen.schoolId },
    })
    return {
      kind: 'ok',
      token,
      csrfToken,
      userId: user.id,
      displayName: user.display_name,
      schoolId: chosen.schoolId,
      role: chosen.role,
      returnTo: input.returnTo,
    }
  })
}

export async function revokeSession(
  db: Kysely<Database>,
  input: { sessionHash: string; userId: string; schoolId: string; requestId: string },
): Promise<void> {
  await db.transaction().execute(async (trx) => {
    await trx
      .updateTable('sessions')
      .set({ revoked_at: sql`now()` })
      .where('id_hash', '=', input.sessionHash)
      .where('revoked_at', 'is', null)
      .execute()
    await writeAudit(trx, {
      schoolId: input.schoolId,
      actorId: input.userId,
      action: 'logout',
      objectType: 'user',
      objectId: input.userId,
      requestId: input.requestId,
      details: { userId: input.userId },
    })
  })
}
