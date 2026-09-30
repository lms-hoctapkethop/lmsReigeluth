import { expect, test } from '@playwright/test'
import { login, publishReleasedAssignment, setClock } from '../helpers.ts'

test('J06 mất mạng khi soạn rồi nộp có giờ máy chủ', async ({ browser }) => {
  setClock('')
  const teacherContext = await browser.newContext()
  const studentContext = await browser.newContext()
  const teacher = await teacherContext.newPage()
  const student = await studentContext.newPage()
  try {
    await login(teacher, 'gv.lan')
    const title = 'Bài mất mạng J06'
    const released = await publishReleasedAssignment(teacher.request, title, '2020-01-01T00:00:00.000Z')
    await login(student, 'hs.minh')
    await student.goto(`/hoc/bai/${released.releaseId}/muc/${released.itemId}`)
    await expect(student.getByRole('heading', { name: title })).toBeVisible()
    await student.context().setOffline(true)
    await student.getByLabel('Bài làm').fill('Lời giải viết khi mất mạng')
    await expect(student.getByText('Chưa lưu, đang thử lại')).toBeVisible({ timeout: 8_000 })
    await student.context().setOffline(false)
    await expect(student.getByText(/Đã lưu lúc/)).toBeVisible({ timeout: 8_000 })
    await student.getByRole('button', { name: 'Nộp bài' }).click()
    await expect(student.getByText(/Giờ máy chủ:/)).toBeVisible()
    await expect(student.getByText(/Phiên bản 1/)).toBeVisible()
  } finally {
    await student.context().setOffline(false).catch(() => undefined)
    setClock('')
    await teacherContext.close()
    await studentContext.close()
  }
})
