import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { sql, type Kysely } from 'kysely'
import type { Database } from '@hcn/db'

const buckets = [0.05, 0.1, 0.25, 0.5, 0.8, 1, 1.5, 2.5, 5, 10]

type Series = { buckets: number[]; sum: number; count: number }

const series = new Map<string, Series>()

export type RequestLabel = { method: string; route: string; statusClass: string }

export function recordRequest(label: RequestLabel, seconds: number): void {
  const key = `${label.method}|${label.route}|${label.statusClass}`
  const current = series.get(key) ?? { buckets: buckets.map(() => 0), sum: 0, count: 0 }
  current.count += 1
  current.sum += seconds
  for (let index = 0; index < buckets.length; index += 1) {
    const edge = buckets[index] ?? 0
    if (seconds <= edge) {
      const count = current.buckets[index] ?? 0
      current.buckets[index] = count + 1
    }
  }
  series.set(key, current)
}

export function statusClass(status: number): string {
  const band = Math.floor(status / 100)
  if (band < 1 || band > 5) return '0xx'
  return `${band}xx`
}

type BackupSample = { kind: string; ageSeconds: number }

export function readBackupAges(file: string, nowSeconds: number): BackupSample[] {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return []
  }
  const samples: BackupSample[] = []
  for (const line of text.split('\n')) {
    const match = /^hcn_last_backup_timestamp_seconds\{kind="([a-z0-9_]+)"\}\s+(\d+(?:\.\d+)?)$/.exec(line.trim())
    if (!match) continue
    const kind = match[1] ?? ''
    const stamp = Number(match[2])
    if (!kind || !Number.isFinite(stamp)) continue
    samples.push({ kind, ageSeconds: Math.max(0, nowSeconds - stamp) })
  }
  return samples
}

export function renderMetrics(input: {
  pool: { total: number; idle: number; waiting: number }
  pending: number
  dead: number
  filesPending: number
  backups: BackupSample[]
}): string {
  const lines: string[] = []
  lines.push('# TYPE http_request_duration_seconds histogram')
  for (const [key, value] of series) {
    const [method, route, status] = key.split('|')
    const labels = `method="${method}",route="${route}",status_class="${status}"`
    for (let index = 0; index < buckets.length; index += 1) {
      lines.push(`http_request_duration_seconds_bucket{${labels},le="${buckets[index]}"} ${value.buckets[index] ?? 0}`)
    }
    lines.push(`http_request_duration_seconds_bucket{${labels},le="+Inf"} ${value.count}`)
    lines.push(`http_request_duration_seconds_sum{${labels}} ${value.sum}`)
    lines.push(`http_request_duration_seconds_count{${labels}} ${value.count}`)
  }
  lines.push('# TYPE hcn_db_pool_total gauge', `hcn_db_pool_total ${input.pool.total}`)
  lines.push('# TYPE hcn_db_pool_idle gauge', `hcn_db_pool_idle ${input.pool.idle}`)
  lines.push('# TYPE hcn_db_pool_waiting gauge', `hcn_db_pool_waiting ${input.pool.waiting}`)
  lines.push('# TYPE hcn_outbox_pending gauge', `hcn_outbox_pending ${input.pending}`)
  lines.push('# TYPE hcn_outbox_dead gauge', `hcn_outbox_dead ${input.dead}`)
  lines.push('# TYPE hcn_files_pending_scan gauge', `hcn_files_pending_scan ${input.filesPending}`)
  if (input.backups.length > 0) {
    lines.push('# TYPE hcn_last_backup_age_seconds gauge')
    for (const sample of input.backups) {
      lines.push(`hcn_last_backup_age_seconds{kind="${sample.kind}"} ${sample.ageSeconds}`)
    }
  }
  return `${lines.join('\n')}\n`
}

type Counts = { pending: number; dead: number; filesPending: number; at: number }
let counts: Counts | null = null

async function countWhere(db: Kysely<Database>, query: Promise<{ n: string | number | bigint } | undefined>): Promise<number> {
  const row = await query
  return Number(row?.n ?? 0)
}

export async function collectMetrics(db: Kysely<Database>, backupFile: string): Promise<string> {
  const now = Date.now()
  if (!counts || now - counts.at > 15_000) {
    const [pending, dead, filesPending] = await Promise.all([
      countWhere(db, db.selectFrom('outbox_events').select(sql<string>`count(*)::text`.as('n')).where('status', '=', 'pending').executeTakeFirst()),
      countWhere(db, db.selectFrom('outbox_events').select(sql<string>`count(*)::text`.as('n')).where('status', '=', 'dead').executeTakeFirst()),
      countWhere(db, db.selectFrom('files').select(sql<string>`count(*)::text`.as('n')).where('scan_status', '=', 'pending').executeTakeFirst()),
    ])
    counts = { pending, dead, filesPending, at: now }
  }
  const pool = 'pool' in db ? (db as { pool?: { totalCount: number; idleCount: number; waitingCount: number } }).pool : undefined
  return renderMetrics({
    pool: {
      total: pool?.totalCount ?? 0,
      idle: pool?.idleCount ?? 0,
      waiting: pool?.waitingCount ?? 0,
    },
    pending: counts.pending,
    dead: counts.dead,
    filesPending: counts.filesPending,
    backups: readBackupAges(backupFile, Math.floor(now / 1000)),
  })
}

export function startMetricsServer(db: Kysely<Database>, port: number, backupFile: string): Server {
  const server = createServer((request, response) => {
    if (request.url !== '/metrics') {
      response.writeHead(404)
      response.end()
      return
    }
    void collectMetrics(db, backupFile)
      .then((body) => {
        response.writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' })
        response.end(body)
      })
      .catch(() => {
        response.writeHead(500)
        response.end()
      })
  })
  server.listen(port, '0.0.0.0')
  return server
}
