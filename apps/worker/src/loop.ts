import { sql, type Kysely } from 'kysely'
import type { Database } from '@hcn/db'
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
  payload: { fileId?: string }
  attempts: number
  school_id: string
}

/** Tên consumer theo loại sự kiện. Sự kiện không có tên thì đánh dấu done. */
export const consumerByEvent: Record<string, string> = {
  FileUploaded: 'files.scan',
}

export async function processOutbox(db: Kysely<Database>, options: WorkerOptions): Promise<number> {
  return db.transaction().execute(async (trx) => {
    const selected = await sql<EventRow>`
      SELECT id::text, event_id::text, event_type, payload, attempts, school_id::text
      FROM outbox_events
      WHERE status = 'pending' AND available_at <= now()
      ORDER BY id
      LIMIT 20
      FOR UPDATE SKIP LOCKED
    `.execute(trx)
    for (const event of selected.rows) await handleEvent(trx, event, options)
    return selected.rows.length
  })
}

async function handleEvent(db: Kysely<Database>, event: EventRow, options: WorkerOptions): Promise<void> {
  const consumer = consumerByEvent[event.event_type]
  if (!consumer) {
    await mark(db, event.id, 'done', event.attempts, null)
    return
  }
  try {
    if (consumer === 'test.fail') throw new Error('TEST_FAIL')
    if (consumer === 'files.scan' && event.payload.fileId) {
      const result = await applyScan(db, {
        fileId: event.payload.fileId,
        storageDir: options.storageDir,
        host: options.clamdHost,
        port: options.clamdPort,
        timeoutMs: options.timeoutMs ?? 30_000,
      })
      if (result === 'error') throw new Error('SCAN_ERROR')
    }
    await db
      .insertInto('processed_events')
      .values({ event_id: event.event_id, consumer })
      .onConflict((conflict) => conflict.columns(['event_id', 'consumer']).doNothing())
      .execute()
    await mark(db, event.id, 'done', event.attempts, null)
  } catch (error) {
    const next = event.attempts + 1
    const message = error instanceof Error ? error.message : 'error'
    if (consumer === 'files.scan' && next >= 3 && event.payload.fileId) {
      await db
        .updateTable('files')
        .set({ scan_status: 'error', scanned_at: new Date() })
        .where('id', '=', event.payload.fileId)
        .where('scan_status', '=', 'pending')
        .execute()
      await mark(db, event.id, 'done', next, message)
      return
    }
    if (next >= 8) {
      await mark(db, event.id, 'dead', next, message)
      return
    }
    await sql`
      UPDATE outbox_events
      SET attempts = ${next},
          last_error = ${message},
          available_at = now() + make_interval(secs => least(power(2, ${next}), 3600))
      WHERE id = ${event.id}::bigint
    `.execute(db)
  }
}

async function mark(db: Kysely<Database>, id: string, status: 'done' | 'dead', attempts: number, lastError: string | null): Promise<void> {
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
  return () => {
    clearInterval(tick)
    clearInterval(cleanup)
  }
}
