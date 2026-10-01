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
  await page.locator('#username').fill('gv.lan.ph')
  await page.locator('#password').fill('Dev-12345')
  await page.locator('#kc-login').click()
  await expect(page.getByRole('heading', { name: /Giáo viên/ })).toBeVisible({ timeout: 20_000 })
  await expectNoSeriousAxe(page)
  const guardian = page.getByLabel('Ngữ cảnh').locator('option', { hasText: 'Phụ huynh' })
  const guardianValue = await guardian.getAttribute('value')
  if (!guardianValue) throw new Error('Không thấy ngữ cảnh phụ huynh')
  await page.getByLabel('Ngữ cảnh').selectOption(guardianValue)
  await expect(page.getByRole('heading', { name: /Phụ huynh/ })).toBeVisible()
  const logoutResponse = page.waitForResponse(
    (response) => response.url().includes('/auth/logout') && response.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Đăng xuất' }).click()
  expect((await logoutResponse).ok()).toBe(true)
  const me = await page.request.get('/api/v1/me')
  expect(me.status()).toBe(401)
})
