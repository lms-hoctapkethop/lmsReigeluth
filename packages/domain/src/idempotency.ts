import { DomainError } from './errors.ts'
import { pgCode, type Db, type Meta, type Trx } from './org/support.ts'

type Row = {
  status: 'in_progress' | 'completed'
  request_hash: string
  response_body: Record<string, unknown> | null
}

async function load(db: Db | Trx, actorId: string, scope: string, key: string): Promise<Row | undefined> {
  return db
    .selectFrom('idempotency_keys')
    .select(['status', 'request_hash', 'response_body'])
    .where('actor_id', '=', actorId)
    .where('scope', '=', scope)
    .where('key', '=', key)
    .executeTakeFirst()
}

function sameBody<T extends Record<string, unknown>>(row: Row, requestHash: string): T | 'pending' {
  if (row.request_hash !== requestHash) throw new DomainError('IDEMPOTENCY_KEY_REUSED')
  if (row.status === 'completed' && row.response_body) return row.response_body as T
  return 'pending'
}

async function waitCompleted<T extends Record<string, unknown>>(
  db: Db,
  actorId: string,
  scope: string,
  key: string,
  requestHash: string,
): Promise<T | undefined> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50))
    const row = await load(db, actorId, scope, key)
    if (!row) return undefined
    const body = sameBody<T>(row, requestHash)
    if (body !== 'pending') return body
  }
  return undefined
}

/** Khóa idempotency và ghi receipt trong cùng transaction với lệnh. */
export async function withIdempotency<T extends Record<string, unknown>>(
  db: Db,
  meta: Meta,
  input: { scope: string; key: string; requestHash: string; run: (trx: Trx) => Promise<T> },
): Promise<T> {
  if (input.key.length < 8 || input.key.length > 128) throw new DomainError('VALIDATION_FAILED', { reason: 'IDEMPOTENCY_KEY' })
  const existing = await load(db, meta.actor.userId, input.scope, input.key)
  if (existing) {
    const body = sameBody<T>(existing, input.requestHash)
    if (body !== 'pending') return body
    const waited = await waitCompleted<T>(db, meta.actor.userId, input.scope, input.key, input.requestHash)
    if (waited) return waited
    throw new DomainError('REQUEST_IN_PROGRESS')
  }
  try {
    await db
      .insertInto('idempotency_keys')
      .values({
        actor_id: meta.actor.userId,
        scope: input.scope,
        key: input.key,
        request_hash: input.requestHash,
        status: 'in_progress',
        response_status: null,
        response_body: null,
        completed_at: null,
      })
      .execute()
  } catch (error) {
    if (pgCode(error) !== '23505') throw error
    const raced = await load(db, meta.actor.userId, input.scope, input.key)
    if (!raced) throw new DomainError('REQUEST_IN_PROGRESS')
    const body = sameBody<T>(raced, input.requestHash)
    if (body !== 'pending') return body
    const waited = await waitCompleted<T>(db, meta.actor.userId, input.scope, input.key, input.requestHash)
    if (waited) return waited
    throw new DomainError('REQUEST_IN_PROGRESS')
  }
  try {
    return await db.transaction().execute(async (trx) => {
      const result = await input.run(trx)
      await trx
        .updateTable('idempotency_keys')
        .set({
          status: 'completed',
          response_status: 201,
          response_body: result,
          completed_at: meta.clock.now(),
        })
        .where('actor_id', '=', meta.actor.userId)
        .where('scope', '=', input.scope)
        .where('key', '=', input.key)
        .execute()
      return result
    })
  } catch (error) {
    await db
      .deleteFrom('idempotency_keys')
      .where('actor_id', '=', meta.actor.userId)
      .where('scope', '=', input.scope)
      .where('key', '=', input.key)
      .where('status', '=', 'in_progress')
      .execute()
    throw error
  }
}
