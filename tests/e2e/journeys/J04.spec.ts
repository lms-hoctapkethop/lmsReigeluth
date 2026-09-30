import { expect, test } from '@playwright/test'
import { expectNoSeriousAxe, login, publishReleasedAssignment, setClock, tin10a1OfferingId } from '../helpers.ts'

test('J04 giao bài mở sau 2 phút thì hs.minh mới thấy', async ({ browser }) => {
  const opened = new Date()
  setClock(opened.toISOString())
  const teacherContext = await browser.newContext()
  const studentContext = await browser.newContext()
  const teacher = await teacherContext.newPage()
  const student = await studentContext.newPage()
  try {
    await login(teacher, 'gv.lan')
    const available = new Date(opened.getTime() + 2 * 60 * 1000)
    const title = `Bài mở lúc ${available.toISOString()}`
    const released = await publishReleasedAssignment(teacher.request, title, available.toISOString())
    await login(student, 'hs.minh')
    await student.goto('/hoc')
    await expect(student.getByRole('heading', { name: 'Việc cần làm' })).toBeVisible()
    await expect(student.getByRole('link', { name: title })).toHaveCount(0)
    await expectNoSeriousAxe(student)
    setClock(new Date(opened.getTime() + 3 * 60 * 1000).toISOString())
    await student.goto('/hoc')
    await expect(student.getByRole('link', { name: title })).toBeVisible()
    await student.goto(`/hoc/bai/${released.releaseId}/muc/${released.itemId}`)
    await expect(student.getByRole('heading', { name: title })).toBeVisible()
    await expectNoSeriousAxe(student)
    await teacher.goto(`/day/lop/${tin10a1OfferingId}/giao`)
    await expect(teacher.getByRole('heading', { name: /Giao bài/ })).toBeVisible()
    await expectNoSeriousAxe(teacher)
  } finally {
    setClock('')
    await teacherContext.close()
    await studentContext.close()
  }
})
