import { execFileSync } from 'node:child_process'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startPostgres18, type Postgres18 } from './postgres.ts'

function hasCommand(command: string, args: string[]): boolean {
  try {
    execFileSync(command, args, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const ready = hasCommand('docker', ['info']) && hasCommand('dbmate', ['--version'])
if (process.env.CI === 'true' && !ready) {
  throw new Error('Job CI cần Docker và dbmate để chạy packages/testkit')
}

describe.skipIf(!ready)('testkit postgres:18', () => {
  let db: Postgres18 | undefined

  beforeAll(async () => {
    db = await startPostgres18()
  }, 300_000)

  afterAll(async () => {
    await db?.stop()
  }, 60_000)

  it('mỗi file nhận một bản sao đã migrate, tách khỏi bản kia', async () => {
    if (!db) throw new Error('Postgres 18 chưa sẵn sàng')
    const leftDb = await db.cloneDatabase('file_a')
    const rightDb = await db.cloneDatabase('file_b')
    expect(leftDb.name).not.toBe(rightDb.name)

    const left = new pg.Client({ connectionString: leftDb.url })
    const right = new pg.Client({ connectionString: rightDb.url })
    await left.connect()
    await right.connect()
    try {
      const migrated = await left.query('SELECT count(*)::int AS n FROM schema_migrations')
      expect(migrated.rows[0]?.n).toBe(5)
      const app = new pg.Client({ connectionString: leftDb.appUrl })
      await app.connect()
      try {
        const who = await app.query<{ rolsuper: boolean; member: boolean }>(
          `SELECT rolsuper, pg_has_role(current_user, 'hcn_app', 'member') AS member FROM pg_roles WHERE rolname = current_user`,
        )
        expect(who.rows[0]?.rolsuper).toBe(false)
        expect(who.rows[0]?.member).toBe(true)
      } finally {
        await app.end()
      }
      const schools = await left.query("SELECT to_regclass('public.schools')::text AS name")
      expect(schools.rows[0]?.name).toBe('schools')
      await left.query('CREATE TABLE testkit_probe (id int)')
      const isolated = await right.query("SELECT to_regclass('public.testkit_probe')::text AS name")
      expect(isolated.rows[0]?.name ?? null).toBeNull()
    } finally {
      await left.end()
      await right.end()
    }
  })
})
