import { defineConfig, devices } from '@playwright/test'

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/hcn?sslmode=disable'
const issuer = process.env.OIDC_ISSUER ?? 'http://localhost:8081/realms/hcn'

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  workers: 1,
  use: { baseURL: 'http://localhost:5173', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm --filter @hcn/api dev',
      url: 'http://127.0.0.1:4319/health/live',
      timeout: 120_000,
      env: {
        APP_ORIGIN: 'http://localhost:5173',
        DATABASE_URL: databaseUrl,
        OIDC_ISSUER: issuer,
        OIDC_CLIENT_ID: 'hcn-web',
        OIDC_CLIENT_SECRET: 'dev-secret-hcn-web',
        COOKIE_SECRET: 'dev-cookie-secret-for-e2e-only-32',
        KEYCLOAK_PROVISIONER_SECRET: 'dev-secret-hcn-provisioner',
        SESSION_TTL_HOURS: '12',
        SESSION_MAX_DAYS: '7',
        TRUST_PROXY: '',
        PORT: '4319',
        HCN_CLOCK_FILE: '/tmp/hcn-e2e-clock',
        FILE_STORAGE_DIR: '/tmp/hcn-e2e-files',
      },
    },
    {
      command: 'pnpm --filter web dev',
      url: 'http://localhost:5173/',
      timeout: 120_000,
    },
  ],
})
