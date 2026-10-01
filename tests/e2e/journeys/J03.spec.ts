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
  await page.waitForURL(/\/realms\/hcn\/protocol\/openid-connect\/auth/, { timeout: 20_000 })
  await page.locator('#username').fill(username)
  await page.locator('#password').fill('Dev-12345')
  await page.locator('#kc-login').click()
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 })
}

async function press(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name, exact: true }).focus()
  await page.keyboard.press('Enter')
}

async function fillLabeled(page: Page, name: string, value: string, index = 0): Promise<void> {
  const field = page.getByLabel(name).nth(index)
  await field.focus()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type(value)
}

test('J03 gv.lan soạn Tin 10, gỡ V01 rồi phát hành', async ({ page }) => {
  await login(page, 'gv.lan')
  const menu = page.getByRole('link', { name: 'Soạn bài' })
  await menu.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Soạn bài' })).toBeVisible()
  await expectNoSeriousAxe(page)
  await page.getByLabel('Tên module').focus()
  await page.keyboard.type('Lập trình cơ bản')
  await page.getByRole('checkbox', { name: /140110\.0601a/ }).focus()
  await page.keyboard.press('Space')
  await page.getByRole('checkbox', { name: /140110\.0603b/ }).focus()
  await page.keyboard.press('Space')
  await expect(page.getByRole('checkbox', { name: /đã đối chiếu, chưa duyệt/ })).toBeDisabled()
  await press(page, 'Tạo module')
  await expect(page.getByRole('heading', { name: 'Lập trình cơ bản' })).toBeVisible()

  await press(page, 'Thêm trang')
  await fillLabeled(page, 'Nội dung trang', 'Đọc ví dụ câu lệnh gán.')
  await press(page, 'Thêm quiz')
  for (let index = 0; index < 4; index += 1) {
    await press(page, 'Thêm câu')
    await fillLabeled(page, 'Đề bài', `Câu lệnh ${index + 1}`, index)
    await fillLabeled(page, 'Gợi ý', 'Nhớ dấu bằng là phép gán', index)
    await page.getByLabel('KC quan sát').nth(index).selectOption({ label: 'KC-TIN10-CAULENH' })
    await page.getByLabel('Lỗi hiểu sai phương án B').nth(index).selectOption({ label: 'M-TIN10-CAULENH' })
  }
  await fillLabeled(page, 'Giải thích', 'Đáp án bí mật không hiện cho học sinh', 0)
  const saveStatus = page.locator('p[role="status"]')
  await expect(saveStatus).toContainText('Đã lưu', { timeout: 12_000 })

  await press(page, 'Thêm nhiệm vụ')
  await fillLabeled(page, 'Tiêu đề nhiệm vụ', 'Tiền điện')
  for (let index = 0; index < 3; index += 1) {
    await press(page, 'Thêm tiêu chí')
    await fillLabeled(page, 'Tiêu đề tiêu chí', ['Đúng số', 'Rõ đơn vị', 'Gọn lời giải'][index] ?? 'Tiêu chí', index)
  }
  await expect(page.getByRole('region', { name: 'Cảnh báo độ phủ' })).toContainText('V01', { timeout: 12_000 })
  await expect(page.getByRole('button', { name: 'Phát hành phiên bản' })).toBeDisabled()
  await expectNoSeriousAxe(page)

  await press(page, 'Thêm tiêu chí')
  await fillLabeled(page, 'Tiêu đề tiêu chí', 'Kiểm thử', 3)
  await page.getByLabel('KC tiêu chí').nth(3).selectOption({ label: 'KC-TIN10-KIEMTHU' })
  await expect(saveStatus).toContainText('Đã lưu', { timeout: 12_000 })
  await expect(page.getByRole('region', { name: 'Cảnh báo độ phủ' })).not.toContainText('V01', { timeout: 12_000 })
  await expect(page.getByRole('button', { name: 'Phát hành phiên bản' })).toBeEnabled()
  await press(page, 'Phát hành phiên bản')
  const reasons = page.getByRole('dialog').getByRole('textbox')
  const count = await reasons.count()
  expect(count).toBeGreaterThan(0)
  for (let index = 0; index < count; index += 1) {
    await reasons.nth(index).focus()
    await page.keyboard.type('Giữ cảnh báo có chủ đích')
  }
  await press(page, 'Xác nhận phát hành')
  await expect(page.getByText('Phiên bản 1')).toBeVisible()

  await page.getByRole('link', { name: 'Xem trước' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText('Xem trước, không ghi tiến độ')).toBeVisible({ timeout: 12_000 })
  await expect(page.getByText('Đáp án bí mật không hiện cho học sinh')).toHaveCount(0)
  await expect(page.getByText('Câu lệnh 1')).toBeVisible()
})
