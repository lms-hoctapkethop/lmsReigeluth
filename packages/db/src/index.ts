import { Kysely, PostgresDialect } from 'kysely'
import pg from 'pg'
import type { Database } from './schema.ts'

export type { Database, Role, UserStatus, SessionContext } from './schema.ts'
export { effectivePrerequisites, proposedEdgesForReview, type KcEdgeRow } from './repositories/kcGraph.ts'

export type AppDatabase = Kysely<Database> & { pool: pg.Pool }

export function createDb(connectionString: string): AppDatabase {
  const pool = new pg.Pool({ connectionString })
  const db = new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
  })
  return Object.assign(db, { pool })
}
