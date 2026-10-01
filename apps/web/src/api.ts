import type { Me } from '@hcn/contracts'

export async function fetchRuntime(): Promise<{ env: string }> {
  const response = await fetch('/api/v1/runtime', { credentials: 'same-origin' })
  if (!response.ok) return { env: 'production' }
  return response.json() as Promise<{ env: string }>
}

export async function fetchMe(): Promise<Me | null> {
  const response = await fetch('/api/v1/me', { credentials: 'same-origin' })
  if (response.status === 401) return null
  if (!response.ok) throw new Error('Không tải được hồ sơ đăng nhập')
  return response.json() as Promise<Me>
}

export async function switchContext(body: { schoolId: string; role: string }, csrfToken: string): Promise<Me> {
  const response = await fetch('/api/v1/me/context', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'content-type': 'application/json',
      'x-csrf-token': csrfToken,
    },
    body: JSON.stringify({ schoolId: body.schoolId, role: body.role }),
  })
  if (!response.ok) throw new Error('Không đổi được ngữ cảnh')
  return response.json() as Promise<Me>
}

export async function logout(csrfToken: string): Promise<string> {
  const response = await fetch('/auth/logout', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'x-csrf-token': csrfToken },
  })
  if (!response.ok) throw new Error('Không đăng xuất được')
  const body = (await response.json()) as { endSessionUrl: string }
  return body.endSessionUrl
}
