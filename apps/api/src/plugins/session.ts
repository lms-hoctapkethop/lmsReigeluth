import { createHash } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { sql, type Kysely } from 'kysely'
import type { Database, Role } from '@hcn/db'
import { DomainError } from '@hcn/domain'
import type { AppConfig } from '../config.ts'

const roles = new Set<Role>(['admin', 'teacher', 'student', 'guardian'])

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function isRole(value: unknown): value is Role {
  return typeof value === 'string' && roles.has(value as Role)
}

export function registerSession(app: FastifyInstance, db: Kysely<Database>, config: AppConfig): void {
  app.decorateRequest('auth', null)
  app.addHook('onRequest', async (request, reply) => {
    const token = request.cookies.hcn_sid
    if (!token) return
    const hash = sha256(token)
    const row = await db
      .selectFrom('sessions')
      .selectAll()
      .where('id_hash', '=', hash)
      .where('revoked_at', 'is', null)
      .where(sql<boolean>`expires_at > now()`)
      .where(sql<boolean>`created_at + make_interval(days => ${config.sessionMaxDays}) > now()`)
      .executeTakeFirst()
    if (!row || !isRole(row.context.role) || !row.context.school_id) return

    const user = await db
      .selectFrom('users')
      .select(['id', 'display_name', 'status'])
      .where('id', '=', row.user_id)
      .executeTakeFirst()
    if (!user) return
    if (user.status === 'locked') {
      await db.updateTable('sessions').set({ revoked_at: sql`now()` }).where('id_hash', '=', hash).execute()
      reply.clearCookie('hcn_sid', { path: '/' })
      throw new DomainError('UNAUTHENTICATED')
    }

    await db
      .updateTable('sessions')
      .set({
        last_seen_at: sql`now()`,
        expires_at: sql`LEAST(now() + make_interval(hours => ${config.sessionTtlHours}), created_at + make_interval(days => ${config.sessionMaxDays}))`,
      })
      .where('id_hash', '=', hash)
      .where(sql<boolean>`last_seen_at < now() - interval '5 minutes'`)
      .execute()

    const memberships = await db
      .selectFrom('school_memberships')
      .select('role')
      .where('user_id', '=', user.id)
      .where('status', '=', 'active')
      .execute()

    request.auth = {
      sessionHash: hash,
      userId: user.id,
      displayName: user.display_name,
      schoolId: row.context.school_id,
      role: row.context.role,
      roles: [row.context.role, ...memberships.map((item) => item.role).filter((role) => role !== row.context.role)],
      csrfToken: row.csrf_token,
      idTokenHint: row.id_token_hint,
    }
  })
}
