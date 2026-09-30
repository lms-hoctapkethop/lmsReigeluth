import { expect, test } from '@playwright/test'
import { expectNoSeriousAxe, login, publishReleasedRubric, setClock, submitAssignmentText, tin10a1OfferingId } from '../helpers.ts'

test('J08 học sinh nộp phiên bản mới thì giáo viên thấy banner và không công bố được bản cũ', async ({ browser }) => {
  setClock('2026-09-15T02:00:00.000Z')
  const teacherContext = await browser.newContext()
  const studentContext = await browser.newContext()
  const teacher = await teacherContext.newPage()
  const student = await studentContext.newPage()
  try {
    await login(teacher, 'gv.lan')
    const title = `Chấm xung đột ${Date.now()}`
    const released = await publishReleasedRubric(teacher.request, title)
    await login(student, 'hs.minh')
    const revision = await submitAssignmentText(student.request, released.releaseId, released.itemId, 'Bản một', 0)
    await teacher.goto(`/day/cham/${tin10a1OfferingId}`)
    await teacher.getByRole('link', { name: title }).click()
    await expect(teacher.getByRole('heading', { name: `Chấm ${title}` })).toBeVisible()
    await submitAssignmentText(student.request, released.releaseId, released.itemId, 'Bản hai', revision)
    await expect(teacher.getByText('HS đã nộp phiên bản mới')).toBeVisible({ timeout: 15_000 })
    await expect(teacher.getByRole('button', { name: 'Công bố', exact: true })).toBeDisabled()
    await expectNoSeriousAxe(teacher)
  } finally {
    setClock('')
    await teacherContext.close()
    await studentContext.close()
  }
})
