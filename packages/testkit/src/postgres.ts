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
  appUrl: string
}

export type Postgres18 = {
  url: string
  templateDatabase: string
  cloneDatabase: (label: string) => Promise<ClonedDatabase>
  stop: () => Promise<void>
}

function databaseUrl(base: string, database: string, login?: { username: string; password: string }): string {
  const url = new URL(base)
  if (login) {
    url.username = login.username
    url.password = login.password
  }
  url.pathname = `/${database}`
  url.searchParams.set('sslmode', 'disable')
  return url.toString()
}

const appLogin = { username: 'hcn_test_app', password: 'hcn_test_app' }

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
    await admin.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hcn_test_app') THEN
          CREATE ROLE hcn_test_app LOGIN PASSWORD 'hcn_test_app' IN ROLE hcn_app;
        END IF;
      END $$;
    `)
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
      return { name, url: databaseUrl(baseUrl, name), appUrl: databaseUrl(baseUrl, name, appLogin) }
    },
    stop: async () => {
      await admin.end()
      await started.stop()
    },
  }
}
