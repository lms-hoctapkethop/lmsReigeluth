import { test, type Browser, type BrowserContext } from '@playwright/test'
import { checkA11y, login } from './helpers.ts'

async function checkRole(browser: Browser, username: string, paths: string[]): Promise<void> {
  const context: BrowserContext = await browser.newContext()
  try {
    const page = await context.newPage()
    await login(page, username)
    for (const path of paths) {
      await page.goto(path)
      await checkA11y(page)
    }
  } finally {
    await context.close()
  }
}

test('checkA11y các route chính', async ({ browser, page }) => {
  await page.goto('/login-required?returnTo=/')
  await checkA11y(page)
  await checkRole(browser, 'gv.lan', ['/', '/chuyen-mon', '/day', '/day/soan', '/thong-bao'])
  await checkRole(browser, 'hs.minh', ['/hoc'])
  await checkRole(browser, 'ph.minh', ['/phu-huynh'])
  await checkRole(browser, 'admin.a', ['/quan-tri', '/quan-tri/tai-khoan', '/quan-tri/phu-huynh'])
})
