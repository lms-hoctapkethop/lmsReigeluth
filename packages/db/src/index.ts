import { Kysely, PostgresDialect } from 'kysely'
import pg from 'pg'
import type { Database } from './schema.ts'

export type { Database, Role, UserStatus, SessionContext } from './schema.ts'
export { effectivePrerequisites, proposedEdgesForReview, type KcEdgeRow } from './repositories/kcGraph.ts'

export function createDb(connectionString: string): Kysely<Database> {
  return new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new pg.Pool({ connectionString }),
    }),
  })
}
