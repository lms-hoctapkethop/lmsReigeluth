export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: Record<string, unknown> | null

  constructor(status: number, code: string, details: Record<string, unknown> | null = null) {
    super(code)
    this.status = status
    this.code = code
    this.details = details
  }
}

export async function apiJson<T>(path: string, csrf?: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (csrf) headers.set('x-csrf-token', csrf)
  if (init.body && !(init.body instanceof FormData) && !headers.has('content-type')) headers.set('content-type', 'application/json')
  const response = await fetch(path, { ...init, headers, credentials: 'same-origin' })
  const payload = (await response.json().catch(() => null)) as { error?: { code?: string; details?: Record<string, unknown> } } | T | null
  if (!response.ok) {
    const error = payload && typeof payload === 'object' && 'error' in payload ? payload.error : undefined
    throw new ApiError(response.status, error?.code ?? 'INTERNAL', error?.details ?? null)
  }
  return payload as T
}

export function uploadFile(
  file: File,
  csrf: string,
  onProgress: (ratio: number) => void,
): Promise<{ id: string; originalName: string; scanStatus: string }> {
  return new Promise((resolve, reject) => {
    const body = new FormData()
    body.append('file', file)
    const request = new XMLHttpRequest()
    request.open('POST', '/api/v1/files')
    request.setRequestHeader('x-csrf-token', csrf)
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total)
    }
    request.onerror = () => reject(new ApiError(0, 'NETWORK'))
    request.onload = () => {
      const payload = JSON.parse(request.responseText) as { id?: string; originalName?: string; scanStatus?: string; error?: { code?: string } }
      if (request.status < 200 || request.status >= 300 || !payload.id) {
        reject(new ApiError(request.status, payload.error?.code ?? 'INTERNAL'))
        return
      }
      resolve({ id: payload.id, originalName: payload.originalName ?? file.name, scanStatus: payload.scanStatus ?? 'pending' })
    }
    request.send(body)
  })
}
