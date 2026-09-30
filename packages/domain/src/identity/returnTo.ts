function isSafePath(value: string): boolean {
  if (!value.startsWith('/')) return false
  if (value.startsWith('//')) return false
  if (value.startsWith('/\\')) return false
  if (value.includes('\\')) return false
  if (value.includes('://')) return false
  return true
}

export function safeReturnTo(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) return '/'
  if (!isSafePath(value)) return '/'
  try {
    const decoded = decodeURIComponent(value)
    if (!isSafePath(decoded)) return '/'
  } catch {
    return '/'
  }
  return value
}
