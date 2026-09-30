import { createHash } from 'node:crypto'
import { sql } from 'kysely'
import { parse } from 'csv-parse/sync'
import { DomainError } from '../errors.ts'
import { IdpAdminError, type IdpAdmin } from './idp-admin.ts'
import { temporaryPassword } from './temporary-password.ts'
import { audit, currentAcademicYear, outbox, requireOrg, type Db, type Meta } from './support.ts'

export type ImportCreated = { userId: string; username: string; temporaryPassword?: string }
export type ImportError = { row: number; code: string; message: string }
export type ImportResult = { created: ImportCreated[]; errors: ImportError[]; passwordsRedacted: boolean }

const roles = new Set(['student', 'teacher', 'guardian'])

export async function importUsers(
  db: Db,
  meta: Meta,
  idp: IdpAdmin,
  input: { csv: string; idempotencyKey: string; issuer: string },
): Promise<ImportResult> {
  requireOrg(meta.actor)
  if (input.idempotencyKey.length < 8 || input.idempotencyKey.length > 128) throw new DomainError('VALIDATION_FAILED')
  const scope = `importUsers:${meta.actor.schoolId}`
  const requestHash = createHash('sha256').update(input.csv).digest('hex')
  const existing = await db
    .selectFrom('idempotency_keys')
    .select(['status', 'request_hash', 'response_body'])
    .where('actor_id', '=', meta.actor.userId)
    .where('scope', '=', scope)
    .where('key', '=', input.idempotencyKey)
    .executeTakeFirst()
  if (existing?.status === 'completed') {
    if (existing.request_hash !== requestHash) throw new DomainError('IDEMPOTENCY_KEY_REUSED')
    return existing.response_body as unknown as ImportResult
  }
  if (existing?.status === 'in_progress') throw new DomainError('REQUEST_IN_PROGRESS')
  try {
    await db
      .insertInto('idempotency_keys')
      .values({
        actor_id: meta.actor.userId,
        scope,
        key: input.idempotencyKey,
        request_hash: requestHash,
        status: 'in_progress',
        response_status: null,
        response_body: null,
        completed_at: null,
      })
      .execute()
  } catch {
    throw new DomainError('REQUEST_IN_PROGRESS')
  }

  try {
    const result = await runImport(db, meta, idp, input.csv, input.issuer)
    const stored: ImportResult = {
      passwordsRedacted: true,
      errors: result.errors,
      created: result.created.map((item) => ({ userId: item.userId, username: item.username })),
    }
    await db
      .updateTable('idempotency_keys')
      .set({
        status: 'completed',
        response_status: 200,
        response_body: stored as unknown as Record<string, unknown>,
        completed_at: meta.clock.now(),
      })
      .where('actor_id', '=', meta.actor.userId)
      .where('scope', '=', scope)
      .where('key', '=', input.idempotencyKey)
      .execute()
    return { ...result, passwordsRedacted: false }
  } catch (error) {
    await db
      .deleteFrom('idempotency_keys')
      .where('actor_id', '=', meta.actor.userId)
      .where('scope', '=', scope)
      .where('key', '=', input.idempotencyKey)
      .where('status', '=', 'in_progress')
      .execute()
    throw error
  }
}

async function runImport(db: Db, meta: Meta, idp: IdpAdmin, csv: string, issuer: string): Promise<ImportResult> {
  let records: Record<string, string>[]
  try {
    records = parse(csv, { columns: true, skip_empty_lines: true, bom: true, relax_column_count: true }) as Record<string, string>[]
  } catch {
    throw new DomainError('VALIDATION_FAILED')
  }
  if (records.length > 2000) throw new DomainError('VALIDATION_FAILED', { reason: 'TOO_MANY_ROWS' })
  const seen = new Set<string>()
  const created: ImportCreated[] = []
  const errors: ImportError[] = []
  const year = await currentAcademicYear(db, meta.actor.schoolId, meta.clock)
  const start = meta.clock.now().toISOString().slice(0, 10)
  for (let index = 0; index < records.length; index += 1) {
    const rowNumber = index + 2
    const row = records[index] ?? {}
    const username = (row.ma_dinh_danh ?? '').trim()
    const role = (row.vai_tro ?? '').trim()
    const name = (row.ho_ten ?? '').trim()
    const classCode = (row.lop ?? '').trim()
    const email = (row.email ?? '').trim()
    const childCode = (row.ma_hs_con ?? '').trim()
    if (!name || !username || !roles.has(role)) {
      errors.push({ row: rowNumber, code: 'INVALID_ROW', message: 'Dòng thiếu họ tên, mã định danh hoặc vai trò.' })
      continue
    }
    if (seen.has(username)) {
      errors.push({ row: rowNumber, code: 'DUPLICATE_IN_FILE', message: 'Mã định danh bị trùng trong tệp.' })
      continue
    }
    seen.add(username)
    let classId: string | null = null
    let yearId: string | null = null
    if (classCode) {
      if (!year) {
        errors.push({ row: rowNumber, code: 'CLASS_NOT_FOUND', message: 'Không có lớp này trong năm học hiện hành.' })
        continue
      }
      const adminClass = await db
        .selectFrom('admin_classes')
        .select(['id', 'academic_year_id'])
        .where('school_id', '=', meta.actor.schoolId)
        .where('academic_year_id', '=', year.id)
        .where('code', '=', classCode)
        .executeTakeFirst()
      if (!adminClass) {
        errors.push({ row: rowNumber, code: 'CLASS_NOT_FOUND', message: 'Không có lớp này trong năm học hiện hành.' })
        continue
      }
      classId = adminClass.id
      yearId = adminClass.academic_year_id
    }
    const password = temporaryPassword()
    let idpId: string | null = null
    try {
      const createdUser = await idp.createUser({
        username,
        displayName: name,
        ...(email ? { email } : {}),
        temporaryPassword: password,
      })
      idpId = createdUser.id
      await db.transaction().execute(async (trx) => {
        await trx
          .insertInto('users')
          .values({
            id: createdUser.id,
            oidc_issuer: issuer,
            oidc_subject: createdUser.id,
            display_name: name,
            email: email || null,
            status: 'active',
          })
          .execute()
        await trx
          .insertInto('school_memberships')
          .values({
            school_id: meta.actor.schoolId,
            user_id: createdUser.id,
            role: role as 'student' | 'teacher' | 'guardian',
            status: 'active',
          })
          .execute()
        if (classId && yearId) {
          await trx
            .insertInto('class_memberships')
            .values({
              school_id: meta.actor.schoolId,
              academic_year_id: yearId,
              class_id: classId,
              learner_id: createdUser.id,
              valid: sql<string>`daterange(${start}::date, NULL, '[)')`,
            })
            .execute()
        }
        if (role === 'guardian' && childCode) {
          const childIdp = await idp.findByUsername(childCode)
          const child = childIdp
            ? await trx.selectFrom('users').select(['id']).where('oidc_subject', '=', childIdp.id).executeTakeFirst()
            : undefined
          if (!child) throw new Error('NO_CHILD')
          await trx
            .insertInto('guardian_links')
            .values({
              school_id: meta.actor.schoolId,
              guardian_id: createdUser.id,
              learner_id: child.id,
              relation: 'guardian',
              status: 'pending',
              verified_by: null,
              verified_at: null,
              revoked_by: null,
              revoked_at: null,
              revoke_reason: null,
            })
            .execute()
        }
        await audit(trx, meta, {
          action: 'user.import',
          objectType: 'user',
          objectId: createdUser.id,
          details: { id: createdUser.id, status: 'created' },
        })
      })
      created.push({ userId: createdUser.id, username, temporaryPassword: password })
    } catch (error) {
      if (idpId) {
        try {
          await idp.deleteUser(idpId)
        } catch {
          errors.push({ row: rowNumber, code: 'ORPHAN', message: 'Không xóa được tài khoản vừa tạo trên máy định danh.' })
          continue
        }
      }
      if (error instanceof IdpAdminError && error.kind === 'exists') {
        errors.push({ row: rowNumber, code: 'USER_EXISTS', message: 'Mã định danh đã tồn tại.' })
      } else if (error instanceof IdpAdminError && error.kind === 'timeout') {
        errors.push({ row: rowNumber, code: 'IDP_TIMEOUT', message: 'Máy định danh không phản hồi.' })
      } else if (error instanceof Error && error.message === 'NO_CHILD') {
        errors.push({ row: rowNumber, code: 'CHILD_NOT_FOUND', message: 'Không tìm thấy học sinh của phụ huynh.' })
      } else if (!(error instanceof IdpAdminError)) {
        errors.push({ row: rowNumber, code: 'DB_ERROR', message: 'Không ghi được dòng này.' })
      } else {
        errors.push({ row: rowNumber, code: 'IDP_ERROR', message: 'Không tạo được tài khoản.' })
      }
    }
  }
  const first = created[0]
  if (first) {
    await outbox(db, {
      schoolId: meta.actor.schoolId,
      aggregateType: 'user',
      aggregateId: first.userId,
      eventType: 'UsersImported',
      payload: { userIds: created.map((item) => item.userId).join(','), status: 'created' },
    })
  }
  return { created, errors, passwordsRedacted: false }
}
