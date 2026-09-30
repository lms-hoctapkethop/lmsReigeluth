import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'

const execFileAsync = promisify(execFile)
const migrationsDir = fileURLToPath(new URL('../../../db/migrations', import.meta.url))
const templateDatabase = 'hcn_template'

export type ClonedDatabase = {
  name: string
  url: string
}

export type Postgres18 = {
  url: string
  templateDatabase: string
  cloneDatabase: (label: string) => Promise<ClonedDatabase>
  stop: () => Promise<void>
}

function databaseUrl(base: string, database: string): string {
  const url = new URL(base)
  url.pathname = `/${database}`
  url.searchParams.set('sslmode', 'disable')
  return url.toString()
}

function assertIdent(name: string): string {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) {
    throw new Error(`Tên cơ sở dữ liệu không hợp lệ: ${name}`)
  }
  return name
}

export async function startPostgres18(): Promise<Postgres18> {
  const started: StartedPostgreSqlContainer = await new PostgreSqlContainer('postgres:18')
    .withDatabase('hcn')
    .withUsername('hcn')
    .withPassword('hcn')
    .start()

  const baseUrl = started.getConnectionUri()
  const admin = new pg.Client({ connectionString: databaseUrl(baseUrl, 'postgres') })
  await admin.connect()

  try {
    await execFileAsync('dbmate', [
      '--migrations-dir',
      migrationsDir,
      '--no-dump-schema',
      '--url',
      databaseUrl(baseUrl, 'hcn'),
      'up',
    ])
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'hcn' AND pid <> pg_backend_pid()`,
    )
    await started.snapshot(templateDatabase)
  } catch (error) {
    await admin.end()
    await started.stop()
    throw error
  }

  return {
    url: databaseUrl(baseUrl, 'hcn'),
    templateDatabase,
    cloneDatabase: async (label: string) => {
      const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 20) || 'file'
      const name = assertIdent(`hcn_${slug}_${randomBytes(3).toString('hex')}`)
      await admin.query(`CREATE DATABASE ${name} TEMPLATE ${templateDatabase}`)
      return { name, url: databaseUrl(baseUrl, name) }
    },
    stop: async () => {
      await admin.end()
      await started.stop()
    },
  }
}
