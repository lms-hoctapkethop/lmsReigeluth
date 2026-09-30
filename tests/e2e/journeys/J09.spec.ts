import { expect, test } from '@playwright/test'
import { expectNoSeriousAxe, login, publishReleasedRubric, setClock, submitAssignmentText, tin10a1OfferingId } from '../helpers.ts'

test('J09 công bố quyết định đạt thì hồ sơ tách ba lớp số liệu', async ({ browser }) => {
  setClock('2026-09-15T02:00:00.000Z')
  const teacherContext = await browser.newContext()
  const studentContext = await browser.newContext()
  const teacher = await teacherContext.newPage()
  const student = await studentContext.newPage()
  try {
    await login(teacher, 'gv.lan')
    const title = `Chấm có quyết định ${Date.now()}`
    const released = await publishReleasedRubric(teacher.request, title)
    await login(student, 'hs.minh')
    await submitAssignmentText(student.request, released.releaseId, released.itemId, 'Bài đạt', 0)
    await teacher.goto(`/day/cham/${tin10a1OfferingId}`)
    await teacher.getByRole('link', { name: title }).click()
    await teacher.getByRole('heading', { name: 'Rubric' }).click()
    await teacher.keyboard.press('1')
    await teacher.getByRole('button', { name: 'Công bố', exact: true }).click()
    await teacher.getByRole('checkbox', { name: released.requirementCode }).check()
    await teacher.getByLabel(`Lý do ${released.requirementCode}`).fill('Đạt yêu cầu này')
    await teacher.getByRole('button', { name: 'Xác nhận công bố' }).click()
    await expect(teacher.getByText('Đã công bố nhận xét.')).toBeVisible()
    await student.goto(`/hoc/ho-so/${tin10a1OfferingId}`)
    await expect(student.getByRole('heading', { name: 'Hoạt động' })).toBeVisible()
    await expect(student.getByRole('heading', { name: 'Kết luận của GV' })).toBeVisible()
    await expect(student.getByRole('heading', { name: 'Minh chứng' })).toBeVisible()
    await expect(student.getByText('Đạt', { exact: true })).toBeVisible()
    await expect(student.getByText('cập nhật lúc').first()).toBeVisible()
    await expectNoSeriousAxe(student)
  } finally {
    setClock('')
    await teacherContext.close()
    await studentContext.close()
  }
})
