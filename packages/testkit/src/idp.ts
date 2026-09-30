// Ambient module: a side-effect import would be an augmentation of an untyped package.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- pulls the declaration into every program that compiles this file
/// <reference path="./oidc-provider.d.ts" />
import { createServer, type Server } from 'node:http'
import Provider from 'oidc-provider'

export type FakeIdp = {
  issuer: string
  loginAs: (subject: string) => void
  stop: () => Promise<void>
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
}

export async function startFakeIdp(options: { clientId: string; clientSecret: string; redirectUri: string }): Promise<FakeIdp> {
  const probe = createServer()
  await listen(probe)
  const address = probe.address()
  const port = address && typeof address === 'object' ? address.port : 0
  await new Promise<void>((resolve, reject) => probe.close((error) => (error ? reject(error) : resolve())))
  if (!port) throw new Error('Không mở được cổng cho IdP giả')

  const issuer = `http://127.0.0.1:${port}`
  let accountId = ''
  const provider = new Provider(issuer, {
    clients: [
      {
        client_id: options.clientId,
        client_secret: options.clientSecret,
        redirect_uris: [options.redirectUri],
        response_types: ['code'],
        grant_types: ['authorization_code'],
        token_endpoint_auth_method: 'client_secret_post',
        post_logout_redirect_uris: [`${new URL(options.redirectUri).origin}/`],
      },
    ],
    pkce: { required: () => true },
    features: {
      devInteractions: { enabled: false },
      rpInitiatedLogout: { enabled: true },
    },
    interactions: {
      url(_ctx: unknown, interaction: { uid: string }) {
        return `/interaction/${interaction.uid}`
      },
    },
    cookies: { keys: ['test-idp-cookie-signing-key-32b!!'] },
    async findAccount(_ctx: unknown, id: string) {
      return {
        accountId: id,
        async claims() {
          return { sub: id }
        },
      }
    },
  })

  const callback = provider.callback()
  const server = createServer((req, res) => {
    const url = req.url ?? ''
    if (!url.startsWith('/interaction/')) {
      callback(req, res)
      return
    }
    void (async () => {
      if (!accountId) {
        res.statusCode = 400
        res.end('chua chon tai khoan')
        return
      }
      const details = await provider.interactionDetails(req, res)
      if (details.prompt.name === 'login') {
        await provider.interactionFinished(req, res, { login: { accountId } }, { mergeWithLastSubmission: false })
        return
      }
      const clientId = details.params.client_id ?? options.clientId
      const grant = new provider.Grant({ accountId, clientId })
      grant.addOIDCScope('openid')
      const grantId = await grant.save()
      await provider.interactionFinished(req, res, { consent: { grantId } }, { mergeWithLastSubmission: true })
    })().catch((error: unknown) => {
      if (res.headersSent) return
      res.statusCode = 500
      res.end(error instanceof Error ? error.message : 'idp')
    })
  })
  await listen(server)

  return {
    issuer,
    loginAs(subject: string) {
      accountId = subject
    },
    stop: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  }
}
