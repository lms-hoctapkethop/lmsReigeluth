import { sql } from 'kysely'
import { DomainError } from '../errors.ts'
import { authorize, type Actor } from '../identity/policies.ts'
import { audit, pgCode, type Db, type Meta, type Trx } from '../org/support.ts'

export type { Db, Meta, Trx }

export function requireRead(actor: Actor): void {
  authorize(actor, 'curriculum.read', {})
}

export function requirePropose(actor: Actor): void {
  authorize(actor, 'curriculum.propose', {})
}

export function requireReview(actor: Actor): void {
  authorize(actor, 'curriculum.review', {})
}

export function canReviewQueue(actor: Actor): boolean {
  return actor.roles.includes('teacher') || actor.roles.includes('admin')
}

export async function assertReviewer(db: Db | Trx, userId: string, subjects: string[]): Promise<void> {
  const unique = [...new Set(subjects)]
  const rows = await db
    .selectFrom('curriculum_reviewers')
    .select(['subject_code'])
    .where('user_id', '=', userId)
    .where('subject_code', 'in', unique)
    .execute()
  if (rows.length !== unique.length) throw new DomainError('FORBIDDEN')
}

export function rejectSelfReview(createdBy: string | null, actorId: string): void {
  if (createdBy && createdBy === actorId) throw new DomainError('VALIDATION_FAILED', { reason: 'SELF_REVIEW' })
}

export async function writeReviewLog(
  db: Db | Trx,
  entry: {
    entityType: 'requirement' | 'kc_version' | 'kc_edge' | 'requirement_kc_link' | 'misconception'
    entityId: string
    action: string
    actorId: string
    fromStatus: string | null
    toStatus: string
    oldText?: string | null
    newText?: string | null
    note?: string | null
  },
): Promise<void> {
  await db
    .insertInto('curriculum_review_log')
    .values({
      entity_type: entry.entityType,
      entity_id: entry.entityId,
      action: entry.action,
      actor_id: entry.actorId,
      from_status: entry.fromStatus,
      to_status: entry.toStatus,
      old_text: entry.oldText ?? null,
      new_text: entry.newText ?? null,
      note: entry.note ?? null,
    })
    .execute()
}

export async function reviewAudit(db: Db | Trx, meta: Meta, action: string, objectType: string, objectId: string, status: string): Promise<void> {
  await audit(db, meta, { action, objectType, objectId, details: { status } })
}

type CycleIds = { fromId: string; toId: string }

function cycleIds(error: unknown): CycleIds | null {
  const code = pgCode(error)
  const message = error instanceof Error ? error.message : ''
  if (code !== '23514' || !message.startsWith('KC_EDGE_CYCLE')) return null
  const match = /edge ([0-9a-f-]{36}) -> ([0-9a-f-]{36})/i.exec(message)
  if (!match?.[1] || !match[2]) return { fromId: '', toId: '' }
  return { fromId: match[1], toId: match[2] }
}

async function kcCode(db: Db | Trx, versionId: string): Promise<string> {
  if (!versionId) return ''
  const row = await db
    .selectFrom('kc_versions')
    .innerJoin('knowledge_components', 'knowledge_components.id', 'kc_versions.kc_id')
    .select(['knowledge_components.code'])
    .where('kc_versions.id', '=', versionId)
    .executeTakeFirst()
  return row?.code ?? versionId
}

async function cyclePath(db: Db | Trx, fromId: string, toId: string): Promise<string> {
  if (!fromId || !toId) return ''
  const edges = await db
    .selectFrom('kc_edges')
    .select(['from_kc_version_id', 'to_kc_version_id'])
    .where('status', '=', 'approved')
    .where('edge_type', 'in', ['prerequisite', 'develops_into'])
    .execute()
  const next = new Map<string, string[]>()
  for (const edge of edges) {
    const list = next.get(edge.from_kc_version_id) ?? []
    list.push(edge.to_kc_version_id)
    next.set(edge.from_kc_version_id, list)
  }
  const queue: string[][] = [[toId]]
  const seen = new Set<string>([toId])
  let found: string[] | null = null
  while (queue.length > 0) {
    const path = queue.shift()
    if (!path) break
    const tip = path[path.length - 1]
    if (!tip) break
    if (tip === fromId) {
      found = path
      break
    }
    for (const hop of next.get(tip) ?? []) {
      if (seen.has(hop)) continue
      seen.add(hop)
      queue.push([...path, hop])
    }
  }
  const versionIds = [fromId, ...(found ?? [toId])]
  const codes: string[] = []
  for (const id of versionIds) codes.push(await kcCode(db, id))
  return codes.join(' → ')
}

export async function withEdgeWrite<T>(db: Trx, write: () => Promise<T>): Promise<T> {
  await sql`SAVEPOINT hcn_kc`.execute(db)
  try {
    const result = await write()
    await sql`RELEASE SAVEPOINT hcn_kc`.execute(db)
    return result
  } catch (error) {
    const ids = cycleIds(error)
    if (!ids) throw error
    await sql`ROLLBACK TO SAVEPOINT hcn_kc`.execute(db)
    const fromKc = await kcCode(db, ids.fromId)
    const toKc = await kcCode(db, ids.toId)
    const path = await cyclePath(db, ids.fromId, ids.toId)
    throw new DomainError('KC_EDGE_CYCLE', { fromKc, toKc, path })
  }
}

export function revisionOf(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value)
  return String(Math.round(date.getTime() * 1000))
}

export function parseRevision(header: string | undefined): string {
  if (!header) throw new DomainError('VALIDATION_FAILED', { reason: 'MISSING_IF_MATCH' })
  const quoted = /^W\/"(\d+)"$/.exec(header)
  const raw = quoted?.[1] ?? header
  if (!/^\d+$/.test(raw)) throw new DomainError('VALIDATION_FAILED', { reason: 'BAD_IF_MATCH' })
  return raw
}
