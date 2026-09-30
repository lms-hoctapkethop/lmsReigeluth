import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { afterAll, describe, expect, it } from 'vitest'
import { GenericContainer, Wait } from 'testcontainers'
import { KeycloakAdmin } from '../src/adapters/keycloak-admin.ts'

function commandOk(command: string, args: string[]): boolean {
  try {
    execFileSync(command, args, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const ready = commandOk('docker', ['info'])
if (process.env.CI === 'true' && !ready) throw new Error('Job CI cần Docker để chạy Keycloak')

describe.skipIf(!ready)('Keycloak admin', () => {
  let base = ''
  let stop: (() => Promise<unknown>) | undefined

  afterAll(async () => {
    await stop?.()
  })

  it('tạo, khóa và đặt lại mật khẩu trên Keycloak 26.7', async () => {
    const realm = readFileSync(new URL('../../../deploy/keycloak/realm-hcn.dev.json', import.meta.url), 'utf8')
    const container = await new GenericContainer('quay.io/keycloak/keycloak:26.7')
      .withExposedPorts(8080)
      .withEnvironment({
        KC_BOOTSTRAP_ADMIN_USERNAME: 'admin',
        KC_BOOTSTRAP_ADMIN_PASSWORD: 'admin',
        KC_HTTP_ENABLED: 'true',
        KC_HOSTNAME_STRICT: 'false',
      })
      .withCopyContentToContainer([{ content: realm, target: '/opt/keycloak/data/import/realm-hcn.dev.json' }])
      .withCommand(['start-dev', '--import-realm'])
      .withWaitStrategy(Wait.forHttp('/realms/hcn/.well-known/openid-configuration', 8080).forStatusCode(200))
      .withStartupTimeout(180_000)
      .start()
    stop = () => container.stop()
    const port = container.getMappedPort(8080)
    base = `http://127.0.0.1:${port}/realms/hcn`
    const admin = new KeycloakAdmin({
      issuer: base,
      clientId: 'hcn-provisioner',
      clientSecret: 'dev-secret-hcn-provisioner',
    })
    const username = 'hs.kc.moi'
    const created = await admin.createUser({ username, displayName: 'HS KC', temporaryPassword: 'Tam-thoi-99' })
    expect(created.id).toBeTruthy()
    const found = await admin.findByUsername(username)
    expect(found?.id).toBe(created.id)
    await admin.setEnabled(created.id, false)
    await admin.resetTemporaryPassword(created.id, 'Tam-thoi-88')
    await admin.deleteUser(created.id)
    expect(await admin.findByUsername(username)).toBeNull()
  }, 180_000)
})
