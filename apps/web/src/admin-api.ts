import type { Me } from '@hcn/contracts'

export type Offering = { id: string; code: string; title: string; subjectCode: string; grade: number; term: number }
export type Year = { id: string; code: string; startsOn: string; endsOn: string }
export type AdminClass = { id: string; code: string; grade: number; academicYearId: string }
export type Course = { id: string; title: string; subjectCode: string; grade: number }
export type SchoolUser = { id: string; displayName: string; email: string | null; status: 'active' | 'locked'; roles: string[] }
export type GuardianLink = {
  id: string
  guardianId: string
  guardianName: string
  learnerId: string
  learnerName: string
  relation: string
  status: 'pending' | 'verified' | 'revoked'
}
export type ImportSlip = { userId: string; username: string; temporaryPassword?: string }
export type ImportResult = { created: ImportSlip[]; errors: { row: number; code: string; message: string }[]; passwordsRedacted: boolean }

async function send(path: string, csrf: string | undefined, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  if (csrf) headers.set('x-csrf-token', csrf)
  if (init.body && !(init.body instanceof FormData) && !headers.has('content-type')) headers.set('content-type', 'application/json')
  return fetch(path, { ...init, headers, credentials: 'same-origin' })
}

export async function readJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin' })
  if (!response.ok) throw new Error('Không tải được dữ liệu')
  return response.json() as Promise<T>
}

export async function postJson<T>(path: string, csrf: string, body: unknown): Promise<T> {
  const response = await send(path, csrf, { method: 'POST', body: JSON.stringify(body) })
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null
    throw new Error(payload?.error?.message ?? 'Không thực hiện được')
  }
  return response.json() as Promise<T>
}

export type { Me }
