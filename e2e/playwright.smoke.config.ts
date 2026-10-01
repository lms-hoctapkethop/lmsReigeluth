import { defineConfig, devices } from '@playwright/test'

const probe = process.env.STAGING_PROBE_TOKEN

export default defineConfig({
  testDir: '.',
  timeout: 120_000,
  use: {
    baseURL: process.env.BASE_URL,
    trace: 'retain-on-failure',
    extraHTTPHeaders: probe ? { 'X-HCN-Probe': probe } : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
