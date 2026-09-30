import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

async function expectNoSeriousAxe(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).analyze()
  const blocking = result.violations.filter((item) => item.impact === 'serious' || item.impact === 'critical')
  expect(blocking).toEqual([])
}

async function login(page: Page, username: string): Promise<void> {
  await page.goto('/login-required?returnTo=/')
  await page.getByRole('button', { name: 'Đăng nhập' }).click()
  await page.locator('#username').fill(username)
  await page.locator('#password').fill('Dev-12345')
  await page.locator('#kc-login').click()
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 })
}

test('M3 reviewer.tin duyệt chương trình bằng bàn phím', async ({ page }) => {
  await login(page, 'reviewer.tin')
  const menu = page.getByRole('link', { name: 'Chuyên môn' })
  await expect(menu).toBeVisible()
  await menu.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Chuyên môn' })).toBeVisible()
  await expectNoSeriousAxe(page)
  await page.keyboard.press('j')
  await page.getByRole('button', { name: /140110\.0900z/ }).focus()
  await page.keyboard.press('Enter')
  await page.getByLabel('Sửa văn bản').focus()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type('Văn bản đã đối chiếu trên màn chuyên môn.')
  await page.getByLabel('Ghi chú').focus()
  await page.keyboard.type('Đã đối chiếu phụ lục')
  await page.getByRole('button', { name: 'Đối chiếu nguồn' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('status')).toContainText('Đã ghi nhận kết quả duyệt.')
  await page.getByRole('tab', { name: /KC/ }).focus()
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'KC-TIN10-DEXUAT' }).focus()
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Duyệt' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('status')).toContainText('Đã ghi nhận kết quả duyệt.')
  await page.getByRole('tab', { name: /Cạnh/ }).focus()
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'KC-TIN10-RENHANH → KC-TIN10-DIEUKIEN' }).focus()
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Duyệt' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('status')).toContainText('Cạnh này tạo thành vòng')
})
