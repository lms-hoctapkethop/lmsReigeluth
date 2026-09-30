import { randomUUID } from 'node:crypto'
import { IdpAdminError, type CreateIdpUser, type IdpAdmin, type IdpUser } from '@hcn/domain'

export class FakeIdpAdmin implements IdpAdmin {
  readonly users = new Map<string, { id: string; username: string; enabled: boolean; password: string }>()
  failAtCall: { call: number; kind: 'timeout' | 'exists' | 'orphan' } | null = null
  private calls = 0
  private deleteThrows = false

  reset(): void {
    this.users.clear()
    this.calls = 0
    this.failAtCall = null
    this.deleteThrows = false
  }

  async findByUsername(username: string): Promise<IdpUser | null> {
    for (const user of this.users.values()) {
      if (user.username === username) return { id: user.id }
    }
    return null
  }

  async createUser(input: CreateIdpUser): Promise<IdpUser> {
    this.calls += 1
    const plan = this.failAtCall
    if (plan && plan.call === this.calls) {
      if (plan.kind === 'timeout') throw new IdpAdminError('timeout')
      if (plan.kind === 'exists') throw new IdpAdminError('exists')
      const id = `not-a-uuid-${this.calls}`
      this.users.set(id, { id, username: input.username, enabled: true, password: input.temporaryPassword })
      this.deleteThrows = true
      return { id }
    }
    for (const user of this.users.values()) {
      if (user.username === input.username) throw new IdpAdminError('exists')
    }
    const id = randomUUID()
    this.users.set(id, { id, username: input.username, enabled: true, password: input.temporaryPassword })
    return { id }
  }

  async deleteUser(id: string): Promise<void> {
    if (this.deleteThrows && id.startsWith('not-a-uuid-')) throw new IdpAdminError('unavailable')
    this.users.delete(id)
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const user = this.users.get(id)
    if (!user) throw new IdpAdminError('not_found')
    user.enabled = enabled
  }

  async resetTemporaryPassword(id: string, temporaryPassword: string): Promise<void> {
    const user = this.users.get(id)
    if (!user) throw new IdpAdminError('not_found')
    user.password = temporaryPassword
  }
}
