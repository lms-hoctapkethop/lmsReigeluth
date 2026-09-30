import { expect, test } from '@playwright/test'

const moduleId = '50000000-0000-4000-8000-000000000001'

test('SEC-06 trang xem trước không chạy payload độc và không gọi host lạ', async ({ page }) => {
  const dialogs: string[] = []
  const hosts = new Set<string>()
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message())
    void dialog.dismiss()
  })
  page.on('request', (request) => {
    hosts.add(new URL(request.url()).host)
  })
  await page.goto('/login-required?returnTo=/')
  await page.getByRole('button', { name: 'Đăng nhập' }).click()
  await page.locator('#username').fill('gv.lan')
  await page.locator('#password').fill('Dev-12345')
  await page.locator('#kc-login').click()
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 })
  await page.goto(`/day/soan/${moduleId}/xem-truoc`)
  await expect(page.getByRole('status')).toContainText('Xem trước, không ghi tiến độ')
  const body = await page.locator('body').innerText()
  expect(body).toContain('javascript:alert(1)')
  expect(body).toContain('data:text/html,hi')
  expect(body).toContain('vbscript:msgbox(1)')
  expect(body).toContain('JavaScript:alert(1)')
  expect(body).toContain('<b>đậm</b>')
  expect(body).toContain('<script>alert(1)</script>')
  expect(body).toContain('\\href{https://evil.test}{x}')
  expect(body).toContain('\\url{https://evil.test}')
  expect(body).toContain('\\htmlClass{xss}{y}')
  expect(body).toContain('khối lạ')
  expect(body).toContain('ảnh độc')
  expect(dialogs).toEqual([])
  for (const host of hosts) {
    expect(host === 'localhost:5173' || host.startsWith('127.0.0.1') || host.startsWith('localhost:')).toBe(true)
  }
})
