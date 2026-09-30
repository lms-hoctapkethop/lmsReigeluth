import * as client from 'openid-client'
import type { AppConfig } from './config.ts'

const cache = new Map<string, Promise<client.Configuration>>()

export function oidcConfiguration(config: AppConfig): Promise<client.Configuration> {
  const cached = cache.get(config.oidcIssuer)
  if (cached) return cached
  const insecure = config.oidcIssuer.startsWith('http://')
  const pending = client.discovery(
    new URL(config.oidcIssuer),
    config.oidcClientId,
    config.oidcClientSecret,
    client.ClientSecretPost(config.oidcClientSecret),
    insecure ? { execute: [client.allowInsecureRequests] } : undefined,
  )
  cache.set(config.oidcIssuer, pending)
  return pending
}

export async function authorizationRedirect(config: AppConfig, ticket: { state: string; nonce: string; codeVerifier: string }): Promise<URL> {
  const configuration = await oidcConfiguration(config)
  const codeChallenge = await client.calculatePKCECodeChallenge(ticket.codeVerifier)
  return client.buildAuthorizationUrl(configuration, {
    redirect_uri: `${config.appOrigin}/auth/callback`,
    scope: 'openid',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state: ticket.state,
    nonce: ticket.nonce,
  })
}

export async function redeemCode(config: AppConfig, currentUrl: URL, ticket: { state: string; nonce: string; codeVerifier: string }) {
  const configuration = await oidcConfiguration(config)
  return client.authorizationCodeGrant(configuration, currentUrl, {
    pkceCodeVerifier: ticket.codeVerifier,
    expectedState: ticket.state,
    expectedNonce: ticket.nonce,
  })
}

export async function endSessionUrl(config: AppConfig, idTokenHint: string | null): Promise<string> {
  const configuration = await oidcConfiguration(config)
  const parameters: Record<string, string> = {
    post_logout_redirect_uri: `${config.appOrigin}/`,
  }
  if (idTokenHint) parameters.id_token_hint = idTokenHint
  return client.buildEndSessionUrl(configuration, parameters).href
}

export function newOidcSecrets(): { state: string; nonce: string; codeVerifier: string } {
  return {
    state: client.randomState(),
    nonce: client.randomNonce(),
    codeVerifier: client.randomPKCECodeVerifier(),
  }
}
