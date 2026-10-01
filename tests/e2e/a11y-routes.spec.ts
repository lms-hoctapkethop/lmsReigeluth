import { test } from '@playwright/test'
import { checkA11y, login } from './helpers.ts'

test('checkA11y các route chính', async ({ page }) => {
  await page.goto('/login-required?returnTo=/')
  await checkA11y(page)
  await login(page, 'gv.lan')
  for (const path of ['/', '/day', '/day/soan', '/thong-bao']) {
    await page.goto(path)
    await checkA11y(page)
  }
  await login(page, 'hs.minh')
  await page.goto('/hoc')
  await checkA11y(page)
  await login(page, 'ph.minh')
  await page.goto('/phu-huynh')
  await checkA11y(page)
  await login(page, 'admin.a')
  await page.goto('/quan-tri')
  await checkA11y(page)
})
