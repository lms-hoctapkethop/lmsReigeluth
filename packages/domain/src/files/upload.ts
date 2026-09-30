import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Readable } from 'node:stream'
import { once } from 'node:events'
import { DomainError } from '../errors.ts'
import { outbox, type Db, type Meta } from '../org/support.ts'
import { detectUpload, maxUploadBytes, safeOriginalName } from './sniff.ts'

export type FileMeta = {
  id: string
  originalName: string
  sizeBytes: number
  mime: string
  scanStatus: 'pending' | 'clean' | 'infected' | 'error'
}

async function remove(path: string | undefined): Promise<void> {
  if (!path) return
  await rm(path, { force: true }).catch(() => undefined)
}

export async function uploadFile(
  db: Db,
  meta: Meta,
  input: { stream: Readable; originalName: string; storageDir: string; truncated: () => boolean },
): Promise<FileMeta> {
  if (!meta.actor.userId) throw new DomainError('UNAUTHENTICATED')
  const originalName = safeOriginalName(input.originalName)
  const incoming = join(input.storageDir, '.incoming', randomUUID())
  await mkdir(dirname(incoming), { recursive: true })
  const hash = createHash('sha256')
  const sink = createWriteStream(incoming)
  let size = 0
  let finalPath: string | undefined
  let committed = false
  try {
    for await (const chunk of input.stream) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += bytes.length
      if (size > maxUploadBytes) {
        input.stream.destroy()
        break
      }
      hash.update(bytes)
      if (!sink.write(bytes)) await once(sink, 'drain')
    }
    sink.end()
    await once(sink, 'finish')
    if (input.truncated() || size > maxUploadBytes) throw new DomainError('FILE_TOO_LARGE')
    const stored = await detectUpload(await readForType(incoming, size), originalName)
    const now = meta.clock.now()
    const key = `${meta.actor.schoolId}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}`
    finalPath = join(input.storageDir, key)
    await mkdir(dirname(finalPath), { recursive: true })
    await rename(incoming, finalPath)
    const sha256 = hash.digest('hex')
    const saved = await db.transaction().execute(async (trx) => {
      const row = await trx
        .insertInto('files')
        .values({
          school_id: meta.actor.schoolId,
          owner_id: meta.actor.userId,
          storage_key: key,
          sha256,
          size_bytes: size,
          mime_detected: stored,
          original_name: originalName,
          scan_status: 'pending',
          scanned_at: null,
        })
        .returning(['id', 'scan_status'])
        .executeTakeFirstOrThrow()
      await outbox(trx, {
        schoolId: meta.actor.schoolId,
        aggregateType: 'file',
        aggregateId: row.id,
        eventType: 'FileUploaded',
        payload: { fileId: row.id },
      })
      return row
    })
    committed = true
    return { id: saved.id, originalName, sizeBytes: size, mime: stored, scanStatus: saved.scan_status }
  } catch (error) {
    if (!committed) await remove(finalPath ?? incoming)
    throw error
  } finally {
    if (!committed && finalPath) await remove(incoming)
  }
}

async function readForType(path: string, size: number): Promise<Buffer> {
  const { readFile } = await import('node:fs/promises')
  if (size > maxUploadBytes) throw new DomainError('FILE_TOO_LARGE')
  return readFile(path)
}

export function dispositionHeader(originalName: string, inline: boolean): string {
  const name = safeOriginalName(originalName)
  const fallback = name.replace(/[^\w.\-]+/g, '_').slice(0, 80) || 'tep'
  const star = encodeURIComponent(name).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
  return `${inline ? 'inline' : 'attachment'}; filename="${fallback}"; filename*=UTF-8''${star}`
}

export async function readFileMeta(db: Db, meta: Meta, fileId: string): Promise<FileMeta> {
  const row = await loadReadable(db, meta, fileId, true)
  return toMeta(row)
}

export async function openDownload(
  db: Db,
  meta: Meta,
  fileId: string,
  storageDir: string,
  inline: boolean,
): Promise<{ path: string; meta: FileMeta; inline: boolean }> {
  const row = await loadReadable(db, meta, fileId, false)
  if (row.scan_status === 'pending') throw new DomainError('FILE_NOT_SCANNED')
  if (row.scan_status !== 'clean') throw new DomainError('NOT_FOUND')
  const path = join(storageDir, row.storage_key)
  const { access } = await import('node:fs/promises')
  try {
    await access(path)
  } catch {
    throw new DomainError('NOT_FOUND')
  }
  const image = row.mime_detected.startsWith('image/')
  return { path, meta: toMeta(row), inline: inline && image }
}

type FileRow = {
  id: string
  owner_id: string
  school_id: string
  storage_key: string
  original_name: string
  mime_detected: string
  size_bytes: string
  scan_status: FileMeta['scanStatus']
}

function toMeta(row: FileRow): FileMeta {
  return {
    id: row.id,
    originalName: row.original_name,
    sizeBytes: Number(row.size_bytes),
    mime: row.mime_detected,
    scanStatus: row.scan_status,
  }
}

async function loadReadable(db: Db, meta: Meta, fileId: string, metaOnly: boolean): Promise<FileRow> {
  const row = await db
    .selectFrom('files')
    .select(['id', 'owner_id', 'school_id', 'storage_key', 'original_name', 'mime_detected', 'size_bytes', 'scan_status'])
    .where('id', '=', fileId)
    .executeTakeFirst()
  if (!row || row.school_id !== meta.actor.schoolId) throw new DomainError('NOT_FOUND')
  if (row.owner_id === meta.actor.userId) {
    if (!metaOnly && (row.scan_status === 'infected' || row.scan_status === 'error')) throw new DomainError('NOT_FOUND')
    return row
  }
  const linked = await fileLinked(db, meta, fileId)
  if (!linked) throw new DomainError('NOT_FOUND')
  if (row.scan_status === 'infected' || row.scan_status === 'error') throw new DomainError('NOT_FOUND')
  return row
}

async function fileLinked(db: Db, meta: Meta, fileId: string): Promise<boolean> {
  const role = meta.actor.roles[0]
  if (role === 'student' || role === 'guardian') {
    const learnerIds = role === 'student' ? [meta.actor.userId] : await childIds(db, meta)
    if (learnerIds.length === 0) return false
    const submission = await db
      .selectFrom('submission_version_files')
      .innerJoin('submission_versions', 'submission_versions.id', 'submission_version_files.submission_version_id')
      .innerJoin('submissions', 'submissions.id', 'submission_versions.submission_id')
      .select('submissions.id')
      .where('submission_version_files.file_id', '=', fileId)
      .where('submissions.learner_id', 'in', learnerIds)
      .executeTakeFirst()
    if (submission) return true
    const drafts = await db
      .selectFrom('submissions')
      .select('draft_body')
      .where('learner_id', 'in', learnerIds)
      .where('school_id', '=', meta.actor.schoolId)
      .execute()
    if (drafts.some((item) => mentionsFile(item.draft_body, fileId))) return true
    return contentVisible(db, meta, fileId, learnerIds)
  }
  if (role === 'teacher') {
    const owned = await db
      .selectFrom('submission_version_files')
      .innerJoin('submission_versions', 'submission_versions.id', 'submission_version_files.submission_version_id')
      .innerJoin('submissions', 'submissions.id', 'submission_versions.submission_id')
      .innerJoin('module_releases', 'module_releases.id', 'submissions.module_release_id')
      .innerJoin('teacher_assignments', 'teacher_assignments.offering_id', 'module_releases.offering_id')
      .select('teacher_assignments.capabilities')
      .where('submission_version_files.file_id', '=', fileId)
      .where('teacher_assignments.teacher_id', '=', meta.actor.userId)
      .where('teacher_assignments.school_id', '=', meta.actor.schoolId)
      .execute()
    return owned.some((row) => row.capabilities.includes('review') || row.capabilities.includes('view'))
  }
  return false
}

function mentionsFile(body: unknown, fileId: string): boolean {
  if (!body || typeof body !== 'object') return false
  const ids = (body as { fileIds?: unknown }).fileIds
  return Array.isArray(ids) && ids.includes(fileId)
}

async function childIds(db: Db, meta: Meta): Promise<string[]> {
  const rows = await db
    .selectFrom('guardian_links')
    .select('learner_id')
    .where('guardian_id', '=', meta.actor.userId)
    .where('school_id', '=', meta.actor.schoolId)
    .where('status', '=', 'verified')
    .execute()
  return rows.map((row) => row.learner_id)
}

async function contentVisible(db: Db, meta: Meta, fileId: string, learnerIds: string[]): Promise<boolean> {
  const rows = await db
    .selectFrom('content_files')
    .innerJoin('module_releases', 'module_releases.module_version_id', 'content_files.module_version_id')
    .innerJoin('offering_enrollments', 'offering_enrollments.offering_id', 'module_releases.offering_id')
    .select('module_releases.available_from')
    .where('content_files.file_id', '=', fileId)
    .where('offering_enrollments.learner_id', 'in', learnerIds)
    .where('offering_enrollments.status', '=', 'active')
    .execute()
  return rows.some((row) => row.available_from.getTime() <= meta.clock.now().getTime())
}
