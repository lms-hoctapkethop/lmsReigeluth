import { sql, type RawBuilder } from 'kysely'

export function asJson(value: unknown): RawBuilder<unknown> {
  return sql`${JSON.stringify(value)}::jsonb`
}
