import { DomainError, IdpAdminError, type CreateIdpUser, type IdpAdmin, type IdpUser } from '@hcn/domain'

type TokenCache = { token: string; expiresAt: number }

export class KeycloakAdmin implements IdpAdmin {
  private cached: TokenCache | null = null
  private readonly options: { issuer: string; clientId: string; clientSecret: string }

  constructor(options: { issuer: string; clientId: string; clientSecret: string }) {
    this.options = options
  }

  async findByUsername(username: string): Promise<IdpUser | null> {
    const response = await this.call(`/users?username=${encodeURIComponent(username)}&exact=true`, { method: 'GET' })
    if (!response.ok) throw new IdpAdminError('unavailable')
    const rows = (await response.json()) as { id?: string }[]
    const id = rows[0]?.id
    return id ? { id } : null
  }

  async createUser(input: CreateIdpUser): Promise<IdpUser> {
    const response = await this.call('/users', {
      method: 'POST',
      body: JSON.stringify({
        username: input.username,
        enabled: true,
        firstName: input.displayName,
        ...(input.email ? { email: input.email, emailVerified: true } : {}),
        requiredActions: ['UPDATE_PASSWORD'],
        credentials: [{ type: 'password', value: input.temporaryPassword, temporary: true }],
      }),
    })
    if (response.status === 409) throw new IdpAdminError('exists')
    if (response.status !== 201) throw new IdpAdminError('unavailable')
    const location = response.headers.get('location') ?? ''
    const id = location.split('/').pop()
    if (!id) throw new IdpAdminError('unavailable')
    return { id }
  }

  async deleteUser(id: string): Promise<void> {
    const response = await this.call(`/users/${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (response.status !== 204 && response.status !== 404) throw new IdpAdminError('unavailable')
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const current = await this.call(`/users/${encodeURIComponent(id)}`, { method: 'GET' })
    if (current.status === 404) throw new IdpAdminError('not_found')
    if (!current.ok) throw new IdpAdminError('unavailable')
    const body = (await current.json()) as Record<string, unknown>
    const response = await this.call(`/users/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({ ...body, enabled }),
    })
    if (!response.ok) throw new IdpAdminError('unavailable')
  }

  async resetTemporaryPassword(id: string, temporaryPassword: string): Promise<void> {
    const response = await this.call(`/users/${encodeURIComponent(id)}/reset-password`, {
      method: 'PUT',
      body: JSON.stringify({ type: 'password', value: temporaryPassword, temporary: true }),
    })
    if (response.status === 404) throw new IdpAdminError('not_found')
    if (!response.ok) throw new IdpAdminError('unavailable')
  }

  private adminBase(): string {
    const url = new URL(this.options.issuer)
    const realm = url.pathname.split('/').filter(Boolean).pop()
    return `${url.origin}/admin/realms/${realm}`
  }

  private async token(): Promise<string> {
    const now = Date.now()
    if (this.cached && now < this.cached.expiresAt - 30_000) return this.cached.token
    let response: Response
    try {
      response = await fetch(`${this.options.issuer}/protocol/openid-connect/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: this.options.clientId,
          client_secret: this.options.clientSecret,
        }),
        signal: AbortSignal.timeout(5_000),
      })
    } catch (error) {
      throw this.mapNetwork(error)
    }
    if (!response.ok) throw new IdpAdminError('unavailable')
    const json = (await response.json()) as { access_token?: string; expires_in?: number }
    if (!json.access_token || !json.expires_in) throw new IdpAdminError('unavailable')
    this.cached = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 }
    return json.access_token
  }

  private async call(path: string, init: { method: string; body?: string }): Promise<Response> {
    const access = await this.token()
    try {
      return await fetch(`${this.adminBase()}${path}`, {
        method: init.method,
        headers: {
          authorization: `Bearer ${access}`,
          accept: 'application/json',
          ...(init.body ? { 'content-type': 'application/json' } : {}),
        },
        ...(init.body ? { body: init.body } : {}),
        signal: AbortSignal.timeout(5_000),
      })
    } catch (error) {
      throw this.mapNetwork(error)
    }
  }

  private mapNetwork(error: unknown): Error {
    if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) return new IdpAdminError('timeout')
    if (error instanceof Error && error.name === 'TimeoutError') return new IdpAdminError('timeout')
    return new DomainError('INTERNAL')
  }
}
