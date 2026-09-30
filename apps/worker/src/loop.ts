import { sql, type Kysely, type Transaction } from 'kysely'
import type { Database } from '@hcn/db'
import { runDueSoon } from './due-soon.ts'
import { notifyFromEvent } from './notify.ts'
import { applyScan } from './scan.ts'

export type WorkerOptions = {
  storageDir: string
  clamdHost: string
  clamdPort: number
  timeoutMs?: number
}

type EventRow = {
  id: string
  event_id: string
  event_type: string
  payload: Record<string, string>
  attempts: number
  school_id: string
}

export const consumerByEvent: Record<string, string> = {
  FileUploaded: 'files.scan',
  ReleaseCreated: 'notify',
  ReviewPublished: 'notify',
  DecisionSuperseded: 'notify',
}

function pgCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') return error.code
  return undefined
}

/** Tác dụng của consumer và processed_events trong một transaction. Outbox đánh dấu done sau commit. */
export async function commitConsumer(db: Kysely<Database>, event: EventRow, options: WorkerOptions): Promise<void> {
  const consumer = consumerByEvent[event.event_type]
  if (!consumer) return
  await db.transaction().execute(async (trx) => {
    const seen = await trx
      .selectFrom('processed_events')
      .select('event_id')
      .where('event_id', '=', event.event_id)
      .where('consumer', '=', consumer)
      .executeTakeFirst()
    if (seen) return
    if (consumer === 'test.fail') throw new Error('TEST_FAIL')
    if (consumer === 'files.scan') {
      const fileId = event.payload.fileId
      if (!fileId) return
      const result = await applyScan(trx, {
        fileId,
        storageDir: options.storageDir,
        host: options.clamdHost,
        port: options.clamdPort,
        timeoutMs: options.timeoutMs ?? 30_000,
      })
      if (result === 'error') throw new Error('SCAN_ERROR')
    }
    if (consumer === 'notify') await notifyFromEvent(trx, event)
    await trx.insertInto('processed_events').values({ event_id: event.event_id, consumer }).execute()
  })
}

type Executor = Kysely<Database> | Transaction<Database>

export async function acknowledgeOutbox(db: Executor, id: string, attempts: number): Promise<void> {
  await mark(db, id, 'done', attempts, null)
}

export async function processOutbox(db: Kysely<Database>, options: WorkerOptions): Promise<number> {
  return db.transaction().execute(async (trx) => {
    const rows = await sql<EventRow>`
      SELECT id::text, event_id::text, event_type, payload, attempts, school_id::text
      FROM outbox_events
      WHERE status = 'pending' AND available_at <= now()
      ORDER BY id
      LIMIT 20
      FOR UPDATE SKIP LOCKED
    `.execute(trx)
    for (const event of rows.rows) await handleEvent(db, trx, event, options)
    return rows.rows.length
  })
}

async function handleEvent(db: Kysely<Database>, locked: Executor, event: EventRow, options: WorkerOptions): Promise<void> {
  const consumer = consumerByEvent[event.event_type]
  if (!consumer) {
    await mark(locked, event.id, 'done', event.attempts, null)
    return
  }
  try {
    await commitConsumer(db, event, options)
    await acknowledgeOutbox(locked, event.id, event.attempts)
  } catch (error) {
    if (pgCode(error) === '23505') {
      await acknowledgeOutbox(locked, event.id, event.attempts)
      return
    }
    const next = event.attempts + 1
    const message = error instanceof Error ? error.message : 'error'
    if (consumer === 'files.scan' && next >= 3 && event.payload.fileId) {
      await db
        .updateTable('files')
        .set({ scan_status: 'error', scanned_at: new Date() })
        .where('id', '=', event.payload.fileId)
        .where('scan_status', '=', 'pending')
        .execute()
      await mark(locked, event.id, 'done', next, message)
      return
    }
    if (next >= 8) {
      await mark(locked, event.id, 'dead', next, message)
      return
    }
    await sql`
      UPDATE outbox_events
      SET attempts = ${next},
          last_error = ${message},
          available_at = now() + make_interval(secs => least(power(2, ${next}), 3600))
      WHERE id = ${event.id}::bigint
    `.execute(locked)
  }
}

async function mark(db: Executor, id: string, status: 'done' | 'dead', attempts: number, lastError: string | null): Promise<void> {
  await db
    .updateTable('outbox_events')
    .set({
      status,
      attempts,
      last_error: lastError,
      processed_at: status === 'done' ? new Date() : null,
    })
    .where('id', '=', id)
    .execute()
}

export async function cleanupExpired(db: Kysely<Database>): Promise<void> {
  await sql`DELETE FROM idempotency_keys WHERE created_at < now() - interval '7 days'`.execute(db)
  await sql`DELETE FROM sessions WHERE expires_at < now() - interval '1 day'`.execute(db)
}

export function startWorker(db: Kysely<Database>, options: WorkerOptions): () => void {
  const tick = setInterval(() => {
    void processOutbox(db, options)
  }, 1000)
  const cleanup = setInterval(() => {
    void cleanupExpired(db)
  }, 60 * 60 * 1000)
  const dueSoon = setInterval(() => {
    void runDueSoon(db, new Date())
  }, 60 * 60 * 1000)
  return () => {
    clearInterval(tick)
    clearInterval(cleanup)
    clearInterval(dueSoon)
  }
}
