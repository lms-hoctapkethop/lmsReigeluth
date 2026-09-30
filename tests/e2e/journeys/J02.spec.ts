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

async function logout(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Đăng xuất' }).click()
  await page.waitForURL(/\/login-required|\/$/)
}

test('J02 quản trị tạo offering, phân công, ghi danh, xác minh phụ huynh', async ({ page }) => {
  await login(page, 'admin.a')
  await page.getByRole('link', { name: 'Quản trị' }).click()
  await expect(page.getByRole('heading', { name: 'Tổ chức nhà trường' })).toBeVisible()
  await expectNoSeriousAxe(page)
  await page.getByLabel('Môn học').selectOption({ label: 'Tin học 10' })
  await page.getByLabel('Năm học').selectOption({ label: '2026-2027' })
  await page.getByLabel('Mã').fill('Tin10A9')
  await page.getByLabel('Tên').fill('Tin10A9')
  await page.getByRole('button', { name: 'Tạo lớp học phần' }).click()
  await page.getByRole('link', { name: 'Tin10A9' }).click()
  const teacher = page.getByLabel('Giáo viên').locator('option', { hasText: /^Cô Lan$/ })
  const teacherValue = await teacher.getAttribute('value')
  if (!teacherValue) throw new Error('Không thấy cô Lan')
  await page.getByLabel('Giáo viên').selectOption(teacherValue)
  await page.getByRole('button', { name: 'Phân công' }).click()
  await expect(page.getByText('Đã phân công giáo viên.')).toBeVisible()
  await page.getByLabel('Lớp').selectOption({ label: '10A1' })
  await page.getByRole('checkbox', { name: 'Minh' }).check()
  await page.getByRole('button', { name: 'Ghi danh' }).click()
  await expect(page.getByText('Đã ghi danh học sinh.')).toBeVisible()
  await page.getByRole('link', { name: 'Phụ huynh' }).click()
  await expect(page.getByRole('heading', { name: 'Phụ huynh' })).toBeVisible()
  await expectNoSeriousAxe(page)
  await page.getByRole('link', { name: 'Tài khoản' }).click()
  await expect(page.getByRole('heading', { name: 'Tài khoản' })).toBeVisible()
  await expectNoSeriousAxe(page)
  await page.getByRole('link', { name: 'Phụ huynh' }).click()
  await page.getByRole('button', { name: 'Xác minh' }).click()
  await expect(page.getByText('Đã xác minh liên kết.')).toBeVisible()
  await logout(page)

  await login(page, 'gv.lan')
  await page.getByRole('link', { name: 'Lớp đang dạy' }).click()
  await expect(page.getByText('Tin10A9')).toBeVisible()
  await logout(page)

  await login(page, 'hs.minh')
  await page.getByRole('link', { name: 'Lớp của em' }).click()
  await expect(page.getByText('Tin10A9')).toBeVisible()
  await logout(page)

  await login(page, 'ph.an')
  await page.getByRole('link', { name: 'Con của tôi' }).click()
  await expect(page.getByText(/Bình/)).toBeVisible()
})
