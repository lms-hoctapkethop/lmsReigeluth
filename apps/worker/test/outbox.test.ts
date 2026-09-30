import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { sql } from 'kysely'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb, type Database } from '@hcn/db'
import type { Kysely } from 'kysely'
import { personas, schools, seedIdentity } from '@hcn/testkit/identity'
import { startFakeClamd } from '@hcn/testkit/clamd'
import { startPostgres18, type Postgres18 } from '@hcn/testkit'
import { cleanupExpired, consumerByEvent, processOutbox } from '../src/loop.ts'

function commandOk(command: string, args: string[]): boolean {
  try {
    execFileSync(command, args, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const ready = commandOk('docker', ['info']) && commandOk('dbmate', ['--version'])
if (process.env.CI === 'true' && !ready) throw new Error('Job CI cần Docker và dbmate để chạy worker')

const issuer = 'http://idp.test/realms/hcn'

describe.skipIf(!ready)('worker outbox', () => {
  let postgres: Postgres18
  let db: Kysely<Database>
  let storageDir: string

  beforeAll(async () => {
    postgres = await startPostgres18()
    const cloned = await postgres.cloneDatabase('worker_outbox')
    db = createDb(cloned.url)
    storageDir = await mkdtemp(join(tmpdir(), 'hcn-worker-'))
  }, 300_000)

  beforeEach(async () => {
    delete consumerByEvent.Boom
    await sql`
      TRUNCATE files, processed_events, outbox_events, idempotency_keys, sessions, audit_log
      RESTART IDENTITY CASCADE
    `.execute(db)
    await seedIdentity(db, { issuer })
  })

  afterAll(async () => {
    delete consumerByEvent.Boom
    await db?.destroy()
    await postgres?.stop()
    if (storageDir) await rm(storageDir, { recursive: true, force: true })
  })

  async function file(contents: string): Promise<string> {
    const id = crypto.randomUUID()
    const key = `${schools.an.id}/2026/09/${id}`
    const path = join(storageDir, key)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, contents)
    await sql`
      INSERT INTO files (id, school_id, owner_id, storage_key, sha256, size_bytes, mime_detected, original_name, scan_status)
      VALUES (${id}, ${schools.an.id}, ${personas.hsMinh.subject}, ${key}, ${'a'.repeat(64)}, 4, 'text/plain', 'a.txt', 'pending')
    `.execute(db)
    await sql`
      INSERT INTO outbox_events (school_id, aggregate_type, aggregate_id, event_type, payload)
      VALUES (${schools.an.id}, 'file', ${id}, 'FileUploaded', ${JSON.stringify({ fileId: id })}::jsonb)
    `.execute(db)
    return id
  }

  it('hai worker song song không quét trùng', async () => {
    const clamd = await startFakeClamd()
    try {
      const id = await file('bình thường')
      const options = { storageDir, clamdHost: '127.0.0.1', clamdPort: clamd.port, timeoutMs: 5_000 }
      await Promise.all([processOutbox(db, options), processOutbox(db, options)])
      expect(clamd.hits()).toBe(1)
      const rows = await sql<{ n: number; scan_status: string }>`
        SELECT count(*)::int AS n, (SELECT scan_status FROM files WHERE id = ${id}) AS scan_status FROM processed_events
      `.execute(db)
      expect(rows.rows[0]?.n).toBe(1)
      expect(rows.rows[0]?.scan_status).toBe('clean')
    } finally {
      await clamd.close()
    }
  })

  it('sự kiện không có consumer thì done; consumer lỗi 8 lần thì dead', async () => {
    await sql`
      INSERT INTO outbox_events (school_id, aggregate_type, aggregate_id, event_type, payload)
      VALUES (${schools.an.id}, 'path_release', ${crypto.randomUUID()}, 'ReleaseCreated', '{}'::jsonb)
    `.execute(db)
    expect(await processOutbox(db, { storageDir, clamdHost: '127.0.0.1', clamdPort: 1 })).toBe(1)
    const done = await sql<{ status: string }>`SELECT status FROM outbox_events WHERE event_type = 'ReleaseCreated'`.execute(db)
    expect(done.rows[0]?.status).toBe('done')
    consumerByEvent.Boom = 'test.fail'
    await sql`
      INSERT INTO outbox_events (school_id, aggregate_type, aggregate_id, event_type, payload)
      VALUES (${schools.an.id}, 'test', ${crypto.randomUUID()}, 'Boom', '{}'::jsonb)
    `.execute(db)
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await sql`UPDATE outbox_events SET available_at = now() WHERE event_type = 'Boom' AND status = 'pending'`.execute(db)
      await processOutbox(db, { storageDir, clamdHost: '127.0.0.1', clamdPort: 1 })
    }
    const dead = await sql<{ status: string; attempts: number }>`SELECT status, attempts FROM outbox_events WHERE event_type = 'Boom'`.execute(db)
    expect(dead.rows[0]?.status).toBe('dead')
    expect(dead.rows[0]?.attempts).toBe(8)
  })

  it('dọn idempotency quá 7 ngày và phiên hết hạn quá 1 ngày', async () => {
    const oldKey = 'old-key-1234'
    const freshKey = 'new-key-1234'
    await sql`
      INSERT INTO idempotency_keys (actor_id, scope, key, request_hash, status, created_at)
      VALUES
        (${personas.hsMinh.subject}, 'submit:test', ${oldKey}, ${'b'.repeat(64)}, 'completed', now() - interval '8 days'),
        (${personas.hsMinh.subject}, 'submit:test', ${freshKey}, ${'c'.repeat(64)}, 'completed', now())
    `.execute(db)
    const oldHash = 'd'.repeat(64)
    const freshHash = 'e'.repeat(64)
    await sql`
      INSERT INTO sessions (id_hash, user_id, csrf_token, context, created_at, last_seen_at, expires_at)
      VALUES
        (${oldHash}, ${personas.hsMinh.subject}, 'csrf-old', ${JSON.stringify({ school_id: schools.an.id, role: 'student' })}::jsonb, now() - interval '3 days', now() - interval '3 days', now() - interval '2 days'),
        (${freshHash}, ${personas.hsMinh.subject}, 'csrf-new', ${JSON.stringify({ school_id: schools.an.id, role: 'student' })}::jsonb, now(), now(), now() + interval '1 day')
    `.execute(db)
    await cleanupExpired(db)
    const keys = await sql<{ key: string }>`SELECT key FROM idempotency_keys ORDER BY key`.execute(db)
    expect(keys.rows.map((row) => row.key)).toEqual([freshKey])
    const sessions = await sql<{ id_hash: string }>`SELECT id_hash FROM sessions`.execute(db)
    expect(sessions.rows.map((row) => row.id_hash)).toEqual([freshHash])
  })
})
