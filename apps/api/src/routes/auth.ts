import type { FastifyInstance } from 'fastify'
import type { Kysely } from 'kysely'
import type { Database } from '@hcn/db'
import { DomainError, establishSession, revokeSession, safeReturnTo } from '@hcn/domain'
import { oidcCookie, readOidcTicket, sessionCookie, signOidcTicket } from '../cookies.ts'
import type { AppConfig } from '../config.ts'
import { authorizationRedirect, endSessionUrl, newOidcSecrets, redeemCode } from '../oidc.ts'
import { authRateLimit } from '../plugins/rate-limit.ts'
import { createHash } from 'node:crypto'

function deniedPage(logoutUrl: string): string {
  const href = logoutUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  return `<!doctype html>
<html lang="vi">
<head><meta charset="utf-8"><title>Chưa được cấp quyền</title></head>
<body>
  <p>Tài khoản chưa được nhà trường cấp quyền</p>
  <p><a href="${href}">Đăng xuất</a></p>
</body>
</html>`
}

export function registerAuthRoutes(app: FastifyInstance, db: Kysely<Database>, config: AppConfig): void {
  app.get('/auth/login', { config: { public: true, rateLimit: authRateLimit } }, async (request, reply) => {
    const secrets = newOidcSecrets()
    const returnTo = safeReturnTo(request.query && typeof request.query === 'object' && 'returnTo' in request.query ? request.query.returnTo : undefined)
    const location = await authorizationRedirect(config, secrets)
    reply.setCookie(
      'hcn_oidc',
      signOidcTicket({ ...secrets, returnTo, exp: Date.now() + 600_000 }, config.cookieSecret),
      oidcCookie,
    )
    return reply.redirect(location.href)
  })

  app.get('/auth/callback', { config: { public: true, rateLimit: authRateLimit } }, async (request, reply) => {
    const ticket = readOidcTicket(request.cookies.hcn_oidc, config.cookieSecret)
    reply.clearCookie('hcn_oidc', { path: '/auth' })
    if (!ticket) throw new DomainError('BAD_REQUEST')
    const current = new URL(request.url, config.appOrigin)
    const tokens = await redeemCode(config, current, ticket).catch(() => null)
    if (!tokens) throw new DomainError('BAD_REQUEST')
    const claims = tokens.claims()
    const subject = claims?.sub
    const idToken = tokens.id_token
    if (!subject || !idToken) throw new DomainError('BAD_REQUEST')
    const previous = request.cookies.hcn_sid
    const result = await establishSession(db, {
      issuer: config.oidcIssuer,
      subject,
      idToken,
      previousSessionHash: previous ? createHash('sha256').update(previous).digest('hex') : null,
      ttlHours: config.sessionTtlHours,
      maxDays: config.sessionMaxDays,
      requestId: request.id,
      returnTo: ticket.returnTo,
    })
    if (result.kind === 'locked') throw new DomainError('UNAUTHENTICATED')
    if (result.kind === 'denied') {
      const logoutUrl = await endSessionUrl(config, idToken)
      return reply.status(403).type('text/html; charset=utf-8').send(deniedPage(logoutUrl))
    }
    reply.setCookie('hcn_sid', result.token, sessionCookie)
    return reply.redirect(`${config.appOrigin}${result.returnTo}`)
  })

  app.post('/auth/logout', { config: { rateLimit: authRateLimit } }, async (request, reply) => {
    if (!request.auth) throw new DomainError('UNAUTHENTICATED')
    const hint = request.auth.idTokenHint
    await revokeSession(db, {
      sessionHash: request.auth.sessionHash,
      userId: request.auth.userId,
      schoolId: request.auth.schoolId,
      requestId: request.id,
    })
    reply.clearCookie('hcn_sid', { path: '/' })
    return { endSessionUrl: await endSessionUrl(config, hint) }
  })
}
