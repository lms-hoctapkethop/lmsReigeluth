import { expect, test } from '@playwright/test'

async function login(page: import('@playwright/test').Page, username: string, password: string): Promise<void> {
  await page.goto('/login-required?returnTo=/')
  await page.getByRole('button', { name: 'Đăng nhập' }).click()
  await page.waitForURL(/\/realms\/hcn\/protocol\/openid-connect\/auth/, { timeout: 20_000 })
  await page.locator('#username').fill(username)
  await page.locator('#password').fill(password)
  await page.locator('#kc-login').click()
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 })
}

test('khói học sinh lưu nháp, giáo viên mở lớp @smoke', async ({ browser }) => {
  const hsPassword = process.env.STAGING_SMOKE_HS_PASSWORD ?? ''
  const gvPassword = process.env.STAGING_SMOKE_GV_PASSWORD ?? ''
  const studentContext = await browser.newContext()
  const teacherContext = await browser.newContext()
  try {
    const student = await studentContext.newPage()
    await login(student, 'stg.smoke.hs', hsPassword)
    await student.goto('/hoc')
    await expect(student.getByRole('heading', { level: 1 })).toBeVisible()
    const lesson = student.getByRole('link').filter({ hasText: /.+/ }).first()
    if (await student.locator('a[href*="/hoc/bai/"]').count()) {
      await student.locator('a[href*="/hoc/bai/"]').first().click()
      const save = student.getByRole('button', { name: 'Lưu nháp' })
      if (await save.count()) {
        await save.click()
        await expect(student.getByText('Đã lưu')).toBeVisible()
      }
    } else {
      await expect(lesson).toBeVisible()
    }
    const teacher = await teacherContext.newPage()
    await login(teacher, 'stg.smoke.gv', gvPassword)
    await teacher.goto('/day')
    await expect(teacher.getByRole('heading', { level: 1, name: 'Lớp đang dạy' })).toBeVisible()
  } finally {
    await studentContext.close()
    await teacherContext.close()
  }
})
