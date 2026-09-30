import { createReadStream } from 'node:fs'
import { mkdir, rename } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import net from 'node:net'
import type { Kysely, Transaction } from 'kysely'
import type { Database } from '@hcn/db'

type Db = Kysely<Database> | Transaction<Database>

const chunkSize = 64 * 1024

export function instreamScan(filePath: string, host: string, port: number, timeoutMs: number): Promise<'clean' | 'infected'> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port })
    let settled = false
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      socket.destroy()
      reject(error)
    }
    const chunks: Buffer[] = []
    socket.setTimeout(timeoutMs, () => fail(new Error('CLAMD_TIMEOUT')))
    socket.on('error', (error) => fail(error))
    socket.on('data', (buf) => chunks.push(buf))
    socket.on('end', () => {
      if (settled) return
      settled = true
      const text = Buffer.concat(chunks).toString('utf8')
      if (text.includes('FOUND')) resolve('infected')
      else if (text.includes('OK')) resolve('clean')
      else fail(new Error('CLAMD_RESPONSE'))
    })
    socket.on('connect', () => {
      socket.write('zINSTREAM\0')
      const stream = createReadStream(filePath, { highWaterMark: chunkSize })
      stream.on('data', (chunk) => {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        const length = Buffer.alloc(4)
        length.writeUInt32BE(bytes.length, 0)
        const ok = socket.write(Buffer.concat([length, bytes]))
        if (!ok) stream.pause()
      })
      socket.on('drain', () => stream.resume())
      stream.on('error', fail)
      stream.on('end', () => {
        const zero = Buffer.alloc(4)
        socket.write(zero)
      })
    })
  })
}

export async function quarantine(storageDir: string, storageKey: string): Promise<void> {
  const from = join(storageDir, storageKey)
  const to = join(storageDir, '.quarantine', storageKey)
  await mkdir(dirname(to), { recursive: true })
  await rename(from, to)
}

export async function applyScan(
  db: Db,
  input: { fileId: string; storageDir: string; host: string; port: number; timeoutMs: number },
): Promise<'clean' | 'infected' | 'error'> {
  const file = await db
    .selectFrom('files')
    .select(['id', 'school_id', 'storage_key', 'scan_status'])
    .where('id', '=', input.fileId)
    .executeTakeFirst()
  if (!file || file.scan_status !== 'pending') return 'clean'
  let verdict: 'clean' | 'infected'
  try {
    verdict = await instreamScan(join(input.storageDir, file.storage_key), input.host, input.port, input.timeoutMs)
  } catch {
    return 'error'
  }
  if (verdict === 'infected') {
    await quarantine(input.storageDir, file.storage_key)
    await db
      .updateTable('files')
      .set({ scan_status: 'infected', scanned_at: new Date() })
      .where('id', '=', file.id)
      .where('scan_status', '=', 'pending')
      .execute()
    await db
      .insertInto('audit_log')
      .values({
        school_id: file.school_id,
        actor_id: null,
        action: 'file.infected',
        object_type: 'file',
        object_id: file.id,
        request_id: 'worker',
        details: { fileId: file.id },
      })
      .execute()
    return 'infected'
  }
  await db
    .updateTable('files')
    .set({ scan_status: 'clean', scanned_at: new Date() })
    .where('id', '=', file.id)
    .where('scan_status', '=', 'pending')
    .execute()
  return 'clean'
}
