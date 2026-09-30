import { createHmac, timingSafeEqual } from 'node:crypto'

export type OidcTicket = {
  state: string
  nonce: string
  codeVerifier: string
  returnTo: string
  exp: number
}

export function signOidcTicket(ticket: OidcTicket, secret: string): string {
  const body = Buffer.from(JSON.stringify(ticket)).toString('base64url')
  const mac = createHmac('sha256', secret).update(body).digest('base64url')
  return `${body}.${mac}`
}

export function readOidcTicket(value: string | undefined, secret: string): OidcTicket | null {
  if (!value) return null
  const dot = value.lastIndexOf('.')
  if (dot <= 0) return null
  const body = value.slice(0, dot)
  const mac = value.slice(dot + 1)
  const expected = createHmac('sha256', secret).update(body).digest('base64url')
  const left = Buffer.from(mac)
  const right = Buffer.from(expected)
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<OidcTicket>
    if (!parsed.state || !parsed.nonce || !parsed.codeVerifier || !parsed.returnTo || !parsed.exp) return null
    if (parsed.exp < Date.now()) return null
    return {
      state: parsed.state,
      nonce: parsed.nonce,
      codeVerifier: parsed.codeVerifier,
      returnTo: parsed.returnTo,
      exp: parsed.exp,
    }
  } catch {
    return null
  }
}

export const sessionCookie = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax' as const,
  path: '/',
}

export const oidcCookie = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax' as const,
  path: '/auth',
  maxAge: 600,
}
