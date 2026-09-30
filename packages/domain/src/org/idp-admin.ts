export class IdpAdminError extends Error {
  readonly kind: 'exists' | 'timeout' | 'unavailable' | 'not_found'

  constructor(kind: 'exists' | 'timeout' | 'unavailable' | 'not_found') {
    super(kind)
    this.name = 'IdpAdminError'
    this.kind = kind
  }
}

export type IdpUser = { id: string }

export type CreateIdpUser = {
  username: string
  displayName: string
  email?: string
  temporaryPassword: string
}

export interface IdpAdmin {
  findByUsername(username: string): Promise<IdpUser | null>
  createUser(input: CreateIdpUser): Promise<IdpUser>
  deleteUser(id: string): Promise<void>
  setEnabled(id: string, enabled: boolean): Promise<void>
  resetTemporaryPassword(id: string, temporaryPassword: string): Promise<void>
}
