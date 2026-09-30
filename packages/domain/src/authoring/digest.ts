import { createHash } from 'node:crypto'
import serialize from 'canonicalize'
import { DomainError } from '../errors.ts'

export function stripClientKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripClientKeys)
  if (!value || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'clientKey') continue
    out[key] = stripClientKeys(child)
  }
  return out
}

/** sha256 hex của JCS (RFC 8785) sau khi bỏ mọi clientKey. */
export function draftDigest(payload: unknown): string {
  const canonical = serialize(stripClientKeys(payload))
  if (!canonical) throw new DomainError('VALIDATION_FAILED')
  return createHash('sha256').update(canonical).digest('hex')
}

export function requestDigest(body: unknown): string {
  const canonical = serialize(body)
  if (!canonical) throw new DomainError('VALIDATION_FAILED')
  return createHash('sha256').update(canonical).digest('hex')
}
