import { DomainError } from '../errors.ts'
import { canReviewQueue, type Db, type Meta } from './support.ts'

export async function getKcVersionDetail(db: Db, meta: Meta, kcVersionId: string) {
  if (!canReviewQueue(meta.actor)) throw new DomainError('FORBIDDEN')
  const version = await db
    .selectFrom('kc_versions')
    .innerJoin('knowledge_components', 'knowledge_components.id', 'kc_versions.kc_id')
    .select([
      'kc_versions.id',
      'kc_versions.kc_id',
      'kc_versions.version_no',
      'kc_versions.name',
      'kc_versions.observable_criteria',
      'kc_versions.status',
      'knowledge_components.code',
      'knowledge_components.subject_code',
    ])
    .where('kc_versions.id', '=', kcVersionId)
    .executeTakeFirst()
  if (!version) throw new DomainError('NOT_FOUND')
  const previous = await db
    .selectFrom('kc_versions')
    .select(['id', 'name', 'observable_criteria', 'version_no', 'status'])
    .where('kc_id', '=', version.kc_id)
    .where('version_no', '=', version.version_no - 1)
    .executeTakeFirst()
  const edges = previous
    ? await db
        .selectFrom('kc_edges')
        .innerJoin('kc_versions as src', 'src.id', 'kc_edges.from_kc_version_id')
        .innerJoin('kc_versions as dst', 'dst.id', 'kc_edges.to_kc_version_id')
        .innerJoin('knowledge_components as sf', 'sf.id', 'src.kc_id')
        .innerJoin('knowledge_components as st', 'st.id', 'dst.kc_id')
        .select(['kc_edges.id', 'sf.code as fromCode', 'st.code as toCode', 'src.name as fromName', 'dst.name as toName'])
        .where('kc_edges.status', '=', 'approved')
        .where((eb) => eb.or([eb('kc_edges.from_kc_version_id', '=', previous.id), eb('kc_edges.to_kc_version_id', '=', previous.id)]))
        .execute()
    : []
  const links = previous
    ? await db
        .selectFrom('requirement_kc_links')
        .innerJoin('curriculum_requirements', 'curriculum_requirements.id', 'requirement_kc_links.requirement_id')
        .select(['requirement_kc_links.id', 'curriculum_requirements.code791_stem as code'])
        .where('requirement_kc_links.kc_version_id', '=', previous.id)
        .where('requirement_kc_links.status', '=', 'approved')
        .execute()
    : []
  return {
    id: version.id,
    code: version.code,
    subjectCode: version.subject_code,
    name: version.name,
    observableCriteria: version.observable_criteria,
    status: version.status,
    previous: previous
      ? { id: previous.id, name: previous.name, observableCriteria: previous.observable_criteria, status: previous.status }
      : null,
    edges,
    links,
  }
}
