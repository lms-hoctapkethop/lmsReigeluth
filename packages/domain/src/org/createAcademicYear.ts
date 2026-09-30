import { randomUUID } from 'node:crypto'
import { DomainError } from '../errors.ts'
import { audit, outbox, pgCode, requireOrg, type Db, type Meta } from './support.ts'

export async function createAcademicYear(
  db: Db,
  meta: Meta,
  input: { code: string; startsOn: string; endsOn: string },
): Promise<{ id: string; code: string; startsOn: string; endsOn: string }> {
  requireOrg(meta.actor)
  if (!/^[0-9]{4}-[0-9]{4}$/.test(input.code) || input.endsOn <= input.startsOn) {
    throw new DomainError('VALIDATION_FAILED')
  }
  const id = randomUUID()
  try {
    await db.transaction().execute(async (trx) => {
      await trx
        .insertInto('academic_years')
        .values({
          id,
          school_id: meta.actor.schoolId,
          code: input.code,
          starts_on: input.startsOn,
          ends_on: input.endsOn,
        })
        .execute()
      await audit(trx, meta, {
        action: 'academic_year.create',
        objectType: 'academic_year',
        objectId: id,
        details: { id, status: 'created' },
      })
      await outbox(trx, {
        schoolId: meta.actor.schoolId,
        aggregateType: 'academic_year',
        aggregateId: id,
        eventType: 'AcademicYearCreated',
        payload: { academicYearId: id, status: 'created' },
      })
    })
  } catch (error) {
    if (pgCode(error) === '23505') throw new DomainError('REVISION_CONFLICT')
    throw error
  }
  return { id, code: input.code, startsOn: input.startsOn, endsOn: input.endsOn }
}

export async function listAcademicYears(db: Db, meta: Meta): Promise<{ id: string; code: string; startsOn: string; endsOn: string }[]> {
  requireOrg(meta.actor)
  const rows = await db
    .selectFrom('academic_years')
    .select(['id', 'code', 'starts_on', 'ends_on'])
    .where('school_id', '=', meta.actor.schoolId)
    .orderBy('starts_on', 'desc')
    .execute()
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    startsOn: row.starts_on.toISOString().slice(0, 10),
    endsOn: row.ends_on.toISOString().slice(0, 10),
  }))
}
