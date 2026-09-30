import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

async function expectNoSeriousAxe(page: import('@playwright/test').Page): Promise<void> {
  const result = await new AxeBuilder({ page }).analyze()
  const blocking = result.violations.filter((item) => item.impact === 'serious' || item.impact === 'critical')
  expect(blocking).toEqual([])
}

test('J01 đăng nhập, đổi ngữ cảnh GV sang PH, đăng xuất', async ({ page }) => {
  await page.goto('/login-required?returnTo=/')
  await expectNoSeriousAxe(page)
  await page.getByRole('button', { name: 'Đăng nhập' }).click()
  await page.locator('#username').fill('gv.lan')
  await page.locator('#password').fill('Dev-12345')
  await page.locator('#kc-login').click()
  await page.waitForURL((url) => url.origin === 'http://localhost:5173', { timeout: 20_000 })
  const arrived = `${page.url()}\n${(await page.locator('body').innerText()).slice(0, 800)}`
  await expect(page.getByRole('heading', { name: /Giáo viên/ }), arrived).toBeVisible()
  await expectNoSeriousAxe(page)
  await page.getByLabel('Ngữ cảnh').selectOption({ label: /Phụ huynh/ })
  await expect(page.getByRole('heading', { name: /Phụ huynh/ })).toBeVisible()
  await page.getByRole('button', { name: 'Đăng xuất' }).click()
  await page.waitForURL(/\/login-required|\/$/)
  const me = await page.request.get('/api/v1/me')
  expect(me.status()).toBe(401)
})
