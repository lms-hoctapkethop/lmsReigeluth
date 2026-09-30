import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, type Database } from '@hcn/db'
import type { Kysely } from 'kysely'
import { seedCurriculum } from '@hcn/domain'
import { startPostgres18, type Postgres18 } from '@hcn/testkit'

function commandOk(command: string, args: string[]): boolean {
  try {
    execFileSync(command, args, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const ready = commandOk('docker', ['info']) && commandOk('dbmate', ['--version'])
if (process.env.CI === 'true' && !ready) throw new Error('Job CI cần Docker và dbmate để chạy seed chương trình')

const seedFile = join(process.cwd(), 'db/seeds/curriculum_requirements.csv')

async function digest(db: Kysely<Database>): Promise<string> {
  const row = await sql<{ digest: string }>`
    SELECT md5(coalesce(string_agg(code791_stem || text || review_status, '|' ORDER BY code791_stem), '')) AS digest
    FROM curriculum_requirements
  `.execute(db)
  return row.rows[0]?.digest ?? ''
}

describe.skipIf(!ready)('seed-curriculum', () => {
  let postgres: Postgres18
  let db: Kysely<Database>

  beforeAll(async () => {
    postgres = await startPostgres18()
    const cloned = await postgres.cloneDatabase('curriculum')
    db = createDb(cloned.url)
  }, 300_000)

  afterAll(async () => {
    await db?.destroy()
    await postgres?.stop()
  })

  it('chạy hai lần không đổi dữ liệu và không ghi đè hàng approved', async () => {
    const first = await seedCurriculum(db, seedFile)
    expect(first.added).toBeGreaterThan(200)
    const before = await digest(db)
    const second = await seedCurriculum(db, seedFile)
    expect(second).toEqual({ added: 0, updated: 0, skipped: first.added })
    expect(await digest(db)).toBe(before)

    const check = await sql<{ review_status: string }>`
      SELECT review_status FROM curriculum_requirements WHERE code791_stem = '020107.0102a'
    `.execute(db)
    expect(check.rows[0]?.review_status).toBe('unverified')

    await sql`
      UPDATE curriculum_requirements
      SET review_status = 'approved', text = 'bản đã duyệt', reviewed_by = NULL, reviewed_at = now()
      WHERE code791_stem = '140110.0101a'
    `.execute(db)
    const dir = mkdtempSync(join(tmpdir(), 'hcn-seed-'))
    const file = join(dir, 'one.csv')
    writeFileSync(file, 'code791,extraction,flags,text,source_doc\n140110.0101a4,check,,nội dung bị sửa,QD791\n140110.0199z4,clean,,hàng mới,QD791\n')
    const third = await seedCurriculum(db, file)
    expect(third.skipped).toBeGreaterThanOrEqual(1)
    expect(third.added).toBe(1)
    const approved = await sql<{ text: string; review_status: string }>`
      SELECT text, review_status FROM curriculum_requirements WHERE code791_stem = '140110.0101a'
    `.execute(db)
    expect(approved.rows[0]).toEqual({ text: 'bản đã duyệt', review_status: 'approved' })
    expect(await digest(db)).not.toBe(before)
    const again = await digest(db)
    await seedCurriculum(db, file)
    expect(await digest(db)).toBe(again)
  })
})
