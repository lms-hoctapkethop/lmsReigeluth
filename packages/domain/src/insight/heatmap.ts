import { sql } from 'kysely'
import { DomainError } from '../errors.ts'
import { authorize } from '../identity/policies.ts'
import { capabilities } from '../learning/gate.ts'
import type { Db, Meta } from '../org/support.ts'
import { needLabels, type NeedStatus } from './labels.ts'
import { R0_MODEL_VERSION } from './r0.ts'
import { rootGaps } from './rootGaps.ts'

export type Heatmap = {
  kcs: { kcVersionId: string; name: string; topoIndex: number }[]
  learners: { learnerId: string; name: string }[]
  cells: { learnerId: string; kcVersionId: string; status: NeedStatus; nObservations: number; value?: number | null }[]
  rootGaps: { learnerId: string; groups: { root: string; affected: string[]; capped: boolean }[] }[]
  modelVersion: string
  lastUpdatedAt: string | null
}

type Column = { kcId: string; kcVersionId: string; code: string; name: string }
type Edge = { from_code: string; to_code: string }

function topo(columns: Column[], edges: Edge[]): Column[] {
  const byCode = new Map(columns.map((column) => [column.code, column]))
  const indegree = new Map(columns.map((column) => [column.code, 0]))
  const next = new Map<string, string[]>()
  for (const edge of edges) {
    if (!byCode.has(edge.from_code) || !byCode.has(edge.to_code)) continue
    const list = next.get(edge.from_code) ?? []
    list.push(edge.to_code)
    next.set(edge.from_code, list)
    indegree.set(edge.to_code, (indegree.get(edge.to_code) ?? 0) + 1)
  }
  const ready = [...indegree.entries()].filter(([, degree]) => degree === 0).map(([code]) => code).sort()
  const ordered: Column[] = []
  const seen = new Set<string>()
  while (ready.length > 0) {
    const code = ready.shift()
    if (!code || seen.has(code)) continue
    seen.add(code)
    const column = byCode.get(code)
    if (column) ordered.push(column)
    for (const hop of next.get(code) ?? []) {
      const left = (indegree.get(hop) ?? 0) - 1
      indegree.set(hop, left)
      if (left === 0) {
        ready.push(hop)
        ready.sort()
      }
    }
  }
  for (const column of [...columns].sort((left, right) => left.code.localeCompare(right.code))) {
    if (!seen.has(column.code)) ordered.push(column)
  }
  return ordered
}

export async function getHeatmap(db: Db, meta: Meta, offeringId: string, includeValues: boolean): Promise<Heatmap> {
  const offering = await db.selectFrom('offerings').select(['id', 'school_id']).where('id', '=', offeringId).executeTakeFirst()
  if (!offering || offering.school_id !== meta.actor.schoolId) throw new DomainError('NOT_FOUND')
  if (!meta.actor.roles.includes('teacher')) throw new DomainError('NOT_FOUND')
  const caps = await capabilities(db, meta, offeringId)
  if (caps.length === 0) throw new DomainError('NOT_FOUND')
  authorize(meta.actor, 'heatmap.read', { teacherAssigned: true })

  const linked = await sql<Column>`
    SELECT DISTINCT ON (k.id) k.id::text AS "kcId", cur.id::text AS "kcVersionId", k.code, cur.name
      FROM module_releases mr
      JOIN module_versions mv ON mv.id = mr.module_version_id
      JOIN module_items mi ON mi.module_version_id = mv.id
      JOIN LATERAL unnest(mv.requirement_ids || mi.requirement_ids) AS req(id) ON true
      JOIN requirement_kc_links l ON l.requirement_id = req.id AND l.status = 'approved'
      JOIN kc_versions linked_v ON linked_v.id = l.kc_version_id
      JOIN knowledge_components k ON k.id = linked_v.kc_id
      JOIN kc_versions cur ON cur.kc_id = k.id AND cur.status = 'approved'
     WHERE mr.offering_id = ${offeringId}::uuid AND mr.school_id = ${meta.actor.schoolId}::uuid
     ORDER BY k.id, cur.version_no DESC
  `.execute(db)
  const edges = linked.rows.length
    ? await sql<Edge>`
        SELECT src.code AS from_code, dst.code AS to_code
          FROM effective_kc_edges e
          JOIN kc_versions vf ON vf.id = e.from_kc_version_id
          JOIN kc_versions vt ON vt.id = e.to_kc_version_id
          JOIN knowledge_components src ON src.id = vf.kc_id
          JOIN knowledge_components dst ON dst.id = vt.kc_id
         WHERE e.edge_type = 'prerequisite'
      `.execute(db)
    : { rows: [] as Edge[] }
  const kcs = topo(linked.rows, edges.rows)
  const learners = await db
    .selectFrom('offering_enrollments')
    .innerJoin('users', 'users.id', 'offering_enrollments.learner_id')
    .select(['offering_enrollments.learner_id as learnerId', 'users.display_name as name'])
    .where('offering_enrollments.offering_id', '=', offeringId)
    .where('offering_enrollments.school_id', '=', meta.actor.schoolId)
    .where('offering_enrollments.status', '=', 'active')
    .orderBy('users.display_name')
    .orderBy('offering_enrollments.learner_id')
    .execute()
  const estimates = kcs.length
    ? await sql<{
        learner_id: string
        kc_id: string
        status: NeedStatus
        value: string | null
        n_observations: number
        computed_at: Date
      }>`
        SELECT learner_id::text, kc_id::text, status, value::text, n_observations, computed_at
          FROM needs_current_kc
         WHERE offering_id = ${offeringId}::uuid AND model_version = ${R0_MODEL_VERSION}
      `.execute(db)
    : { rows: [] }
  const byKey = new Map(estimates.rows.map((row) => [`${row.learner_id}:${row.kc_id}`, row]))
  const latest = { at: null as Date | null }
  const cells = learners.flatMap((learner) =>
    kcs.map((kc) => {
      const found = byKey.get(`${learner.learnerId}:${kc.kcId}`)
      if (found && (!latest.at || found.computed_at > latest.at)) latest.at = found.computed_at
      const cell: Heatmap['cells'][number] = {
        learnerId: learner.learnerId,
        kcVersionId: kc.kcVersionId,
        status: found?.status ?? 'insufficient',
        nObservations: found?.n_observations ?? 0,
      }
      if (includeValues) cell.value = found?.value == null ? null : Number(found.value)
      return cell
    }),
  )
  const prereq = new Map<string, string[]>()
  for (const edge of edges.rows) {
    if (!kcs.some((kc) => kc.code === edge.from_code) || !kcs.some((kc) => kc.code === edge.to_code)) continue
    const list = prereq.get(edge.to_code) ?? []
    list.push(edge.from_code)
    prereq.set(edge.to_code, list)
  }
  const versionByCode = new Map(kcs.map((kc) => [kc.code, kc.kcVersionId]))
  const gaps = learners.map((learner) => {
    const status = new Map(kcs.map((kc) => [kc.code, byKey.get(`${learner.learnerId}:${kc.kcId}`)?.status ?? 'insufficient']))
    const groups = rootGaps(prereq, status).map((group) => ({
      root: versionByCode.get(group.root) ?? group.root,
      affected: group.affected.map((code) => versionByCode.get(code) ?? code),
      capped: group.capped,
    }))
    return { learnerId: learner.learnerId, groups }
  })
  return {
    kcs: kcs.map((kc, index) => ({ kcVersionId: kc.kcVersionId, name: kc.name, topoIndex: index })),
    learners: learners.map((learner) => ({ learnerId: learner.learnerId, name: learner.name })),
    cells,
    rootGaps: gaps,
    modelVersion: R0_MODEL_VERSION,
    lastUpdatedAt: latest.at ? latest.at.toISOString() : null,
  }
}

export { needLabels }
