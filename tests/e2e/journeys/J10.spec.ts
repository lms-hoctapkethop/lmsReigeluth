import { expect, test } from '@playwright/test'
import { expectNoSeriousAxe, login, setClock } from '../helpers.ts'

const hsAn = '10000000-0000-4000-8000-000000000018'

test('J10 phụ huynh xem con, xác nhận đồng hành, và không mở được hồ sơ học sinh khác', async ({ page }) => {
  setClock('2026-09-15T02:00:00.000Z')
  try {
    await login(page, 'ph.minh')
    await page.goto('/phu-huynh')
    await expect(page.getByRole('heading', { name: 'Con của tôi' })).toBeVisible()
    await page.getByRole('link', { name: 'Minh' }).click()
    await expect(page.getByRole('heading', { name: 'Tổng quan' })).toBeVisible()
    await page.getByLabel('Tôi sẽ làm cùng con').fill('Nhắc con ôn bài tối nay')
    await page.getByRole('button', { name: 'Tôi sẽ đồng hành cùng con' }).click()
    await expect(page.getByText('Đã ghi nhận đồng hành.')).toBeVisible()
    await expect(page.getByText('Nhắc con ôn bài tối nay')).toBeVisible()
    await expectNoSeriousAxe(page)
    await page.goto(`/phu-huynh/con/${hsAn}`)
    await expect(page.getByText('Không tìm thấy hoặc bạn không có quyền xem')).toBeVisible()
  } finally {
    setClock('')
  }
})
