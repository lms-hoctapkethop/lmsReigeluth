import { randomUUID } from 'node:crypto'
import { DomainError } from '../errors.ts'
import { audit, outbox, pgCode, requireOrg, sameSchool, type Db, type Meta } from './support.ts'

const relations = new Set(['father', 'mother', 'guardian', 'other'])

export type GuardianLinkDto = {
  id: string
  guardianId: string
  guardianName: string
  learnerId: string
  learnerName: string
  relation: string
  status: 'pending' | 'verified' | 'revoked'
}

export async function createGuardianLink(
  db: Db,
  meta: Meta,
  input: { guardianId: string; learnerId: string; relation: string },
): Promise<GuardianLinkDto> {
  requireOrg(meta.actor)
  if (!relations.has(input.relation) || input.guardianId === input.learnerId) throw new DomainError('VALIDATION_FAILED')
  const people = await db
    .selectFrom('school_memberships')
    .select(['user_id', 'role'])
    .where('school_id', '=', meta.actor.schoolId)
    .where('user_id', 'in', [input.guardianId, input.learnerId])
    .where('status', '=', 'active')
    .execute()
  const guardianOk = people.some((item) => item.user_id === input.guardianId && item.role === 'guardian')
  const learnerOk = people.some((item) => item.user_id === input.learnerId && item.role === 'student')
  if (!guardianOk || !learnerOk) throw new DomainError('NOT_FOUND')
  const id = randomUUID()
  try {
    await db.transaction().execute(async (trx) => {
      await trx
        .insertInto('guardian_links')
        .values({
          id,
          school_id: meta.actor.schoolId,
          guardian_id: input.guardianId,
          learner_id: input.learnerId,
          relation: input.relation as 'father' | 'mother' | 'guardian' | 'other',
          status: 'pending',
          verified_by: null,
          verified_at: null,
          revoked_by: null,
          revoked_at: null,
          revoke_reason: null,
        })
        .execute()
      await audit(trx, meta, {
        action: 'guardian_link.create',
        objectType: 'guardian_link',
        objectId: id,
        details: { id, guardianId: input.guardianId, learnerId: input.learnerId, status: 'pending' },
      })
      await outbox(trx, {
        schoolId: meta.actor.schoolId,
        aggregateType: 'guardian_link',
        aggregateId: id,
        eventType: 'GuardianLinkCreated',
        payload: { linkId: id, status: 'pending' },
      })
    })
  } catch (error) {
    if (pgCode(error) === '23505') throw new DomainError('VALIDATION_FAILED')
    throw error
  }
  const names = await loadNames(db, input.guardianId, input.learnerId)
  return { id, guardianId: input.guardianId, learnerId: input.learnerId, relation: input.relation, status: 'pending', ...names }
}

export async function listGuardianLinks(db: Db, meta: Meta, status?: 'pending' | 'verified' | 'revoked'): Promise<GuardianLinkDto[]> {
  requireOrg(meta.actor)
  let query = db
    .selectFrom('guardian_links')
    .innerJoin('users as guardian', 'guardian.id', 'guardian_links.guardian_id')
    .innerJoin('users as learner', 'learner.id', 'guardian_links.learner_id')
    .select([
      'guardian_links.id as id',
      'guardian_links.guardian_id as guardianId',
      'guardian.display_name as guardianName',
      'guardian_links.learner_id as learnerId',
      'learner.display_name as learnerName',
      'guardian_links.relation as relation',
      'guardian_links.status as status',
    ])
    .where('guardian_links.school_id', '=', meta.actor.schoolId)
    .orderBy('guardian_links.requested_at', 'desc')
  if (status) query = query.where('guardian_links.status', '=', status)
  const rows = await query.execute()
  return rows.map((row) => ({
    id: row.id,
    guardianId: row.guardianId,
    guardianName: row.guardianName,
    learnerId: row.learnerId,
    learnerName: row.learnerName,
    relation: row.relation,
    status: row.status,
  }))
}

async function loadNames(db: Db, guardianId: string, learnerId: string): Promise<{ guardianName: string; learnerName: string }> {
  const rows = await db.selectFrom('users').select(['id', 'display_name']).where('id', 'in', [guardianId, learnerId]).execute()
  return {
    guardianName: rows.find((row) => row.id === guardianId)?.display_name ?? '',
    learnerName: rows.find((row) => row.id === learnerId)?.display_name ?? '',
  }
}

export async function readLink(db: Db, linkId: string): Promise<{ id: string; school_id: string; status: 'pending' | 'verified' | 'revoked'; guardian_id: string; learner_id: string; relation: string } | undefined> {
  return db
    .selectFrom('guardian_links')
    .select(['id', 'school_id', 'status', 'guardian_id', 'learner_id', 'relation'])
    .where('id', '=', linkId)
    .executeTakeFirst()
}

export function assertLinkSchool<T extends { school_id: string }>(link: T | undefined, schoolId: string): asserts link is T {
  sameSchool(link?.school_id, schoolId)
}
