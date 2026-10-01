import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readBackupAges, recordRequest, renderMetrics } from '../src/ops/metrics.ts'

describe('metrics', () => {
  it('thiếu backup.prom thì không xuất tuổi sao lưu, kể cả 0', () => {
    const body = renderMetrics({
      pool: { total: 1, idle: 1, waiting: 0 },
      pending: 2,
      dead: 0,
      filesPending: 3,
      backups: readBackupAges('/tmp/hcn-backup-khong-co.prom', 1_700_000_000),
    })
    expect(body).toContain('hcn_outbox_pending 2')
    expect(body).toContain('hcn_files_pending_scan 3')
    expect(body).not.toContain('hcn_last_backup_age_seconds')
  })

  it('đọc timestamp và không gắn user id vào nhãn', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hcn-backup-'))
    const file = join(dir, 'backup.prom')
    writeFileSync(file, 'hcn_last_backup_timestamp_seconds{kind="pg_full"} 1000\nhcn_last_backup_success{kind="pg_full"} 1\n')
    const backups = readBackupAges(file, 1600)
    recordRequest({ method: 'GET', route: '/health/ready', statusClass: '2xx' }, 0.04)
    const body = renderMetrics({
      pool: { total: 2, idle: 1, waiting: 0 },
      pending: 0,
      dead: 0,
      filesPending: 0,
      backups,
    })
    expect(body).toContain('hcn_last_backup_age_seconds{kind="pg_full"} 600')
    expect(body).toContain('route="/health/ready"')
    expect(body).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/)
  })
})
