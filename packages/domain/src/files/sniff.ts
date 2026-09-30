import { fileTypeFromBuffer } from 'file-type'
import { DomainError } from '../errors.ts'

const MAX_BYTES = 25 * 1024 * 1024

const extensionsByMime: Record<string, readonly string[]> = {
  'application/pdf': ['.pdf'],
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
}

export function safeOriginalName(name: string): string {
  const base = name.split(/[/\\]/).pop()?.replace(/[\u0000-\u001F\u007F]/g, '') ?? ''
  const trimmed = base.trim().slice(0, 200)
  return trimmed.length > 0 ? trimmed : 'tep'
}

function extensionOf(name: string): string {
  const match = /(\.[A-Za-z0-9]+)$/.exec(name)
  return match?.[1]?.toLowerCase() ?? ''
}

function utf8Text(bytes: Buffer): boolean {
  if (bytes.includes(0)) return false
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return true
  } catch {
    return false
  }
}

/** Nhận diện loại theo allowlist docs/05 mục 7.0. Đuôi và MIME phải khớp. ZIP chỉ dành cho Tin 12 ở M10. */
export async function detectUpload(bytes: Buffer, originalName: string): Promise<string> {
  if (bytes.length === 0) throw new DomainError('VALIDATION_FAILED', { reason: 'EMPTY_FILE' })
  if (bytes.length > MAX_BYTES) throw new DomainError('FILE_TOO_LARGE')
  const extension = extensionOf(safeOriginalName(originalName))
  const detected = await fileTypeFromBuffer(bytes)
  if (detected) {
    const allowed = extensionsByMime[detected.mime]
    if (!allowed || !allowed.includes(extension)) throw new DomainError('FILE_TYPE_NOT_ALLOWED')
    return detected.mime
  }
  if (!utf8Text(bytes)) throw new DomainError('FILE_TYPE_NOT_ALLOWED')
  if (extension === '.txt') return 'text/plain'
  if (extension === '.py') return 'text/x-python'
  throw new DomainError('FILE_TYPE_NOT_ALLOWED')
}

export const maxUploadBytes = MAX_BYTES
