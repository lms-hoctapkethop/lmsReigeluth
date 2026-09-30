import { DomainError } from '../errors.ts'
import { pgCode } from '../org/support.ts'
import { requirePropose, reviewAudit, writeReviewLog, type Db, type Meta } from './support.ts'

export async function proposeKc(
  db: Db,
  meta: Meta,
  input: {
    code: string
    subjectCode: string
    grade: number
    name: string
    description?: string
    observableCriteria: string
    requirementIds: string[]
  },
): Promise<{ id: string; kcId: string; code: string; status: string; versionNo: number }> {
  requirePropose(meta.actor)
  try {
    return await db.transaction().execute(async (trx) => {
      const kc = await trx
        .insertInto('knowledge_components')
        .values({ code: input.code, subject_code: input.subjectCode, grade: input.grade })
        .returning(['id', 'code'])
        .executeTakeFirstOrThrow()
      const version = await trx
        .insertInto('kc_versions')
        .values({
          kc_id: kc.id,
          version_no: 1,
          name: input.name,
          description: input.description ?? null,
          observable_criteria: input.observableCriteria,
          status: 'proposed',
          source: 'teacher',
          ai_proposal_id: null,
          created_by: meta.actor.userId,
          reviewed_by: null,
          reviewed_at: null,
        })
        .returning(['id'])
        .executeTakeFirstOrThrow()
      for (const requirementId of input.requirementIds) {
        await trx
          .insertInto('requirement_kc_links')
          .values({
            requirement_id: requirementId,
            kc_version_id: version.id,
            coverage: 'partial',
            status: 'proposed',
            source: 'teacher',
            reviewed_by: null,
            created_by: meta.actor.userId,
          })
          .execute()
      }
      await writeReviewLog(trx, { entityType: 'kc_version', entityId: version.id, action: 'proposed', actorId: meta.actor.userId })
      await reviewAudit(trx, meta, 'curriculum.kc.propose', 'kc_version', version.id, 'proposed')
      return { id: version.id, kcId: kc.id, code: kc.code, status: 'proposed', versionNo: 1 }
    })
  } catch (error) {
    if (pgCode(error) === '23505') throw new DomainError('REVISION_CONFLICT')
    if (pgCode(error) === '23503') throw new DomainError('VALIDATION_FAILED', { reason: 'UNKNOWN_REQUIREMENT' })
    throw error
  }
}
