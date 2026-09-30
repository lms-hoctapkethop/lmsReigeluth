import { expect, test } from '@playwright/test'
import { expectNoSeriousAxe, login, publishReleasedQuiz, setClock, toan7a4OfferingId, toan7CourseId } from '../helpers.ts'

test('J11 hs.binh phiếu ra lớp Toán 7, định dạng số, không ô chat', async ({ browser }) => {
  setClock(new Date().toISOString())
  const teacherContext = await browser.newContext()
  const studentContext = await browser.newContext()
  const teacher = await teacherContext.newPage()
  const student = await studentContext.newPage()
  try {
    await login(teacher, 'gv.hung')
    const released = await publishReleasedQuiz(teacher.request, {
      courseId: toan7CourseId,
      offeringId: toan7a4OfferingId,
      title: 'Phiếu ra lớp phân số',
      purpose: 'exit_ticket',
      kcCode: 'KC-TOAN7-PHANSO',
      showFeedback: 'never',
      questions: [{
        clientKey: 'n1',
        qtype: 'numeric',
        stem: { format: 'hcn-rich/1', blocks: [{ type: 'paragraph', children: [{ text: 'Viết âm ba phần tư.' }] }] },
        answerKey: { value: '-3/4', tolerance: '0' },
        bloomTarget: 2,
        hints: [],
      }],
    })
    await login(student, 'hs.binh')
    await student.setViewportSize({ width: 360, height: 800 })
    await student.goto(`/hoc/bai/${released.releaseId}`)
    await expect(student.getByRole('heading', { name: 'Phiếu ra lớp phân số' })).toBeVisible()
    const field = student.locator('[data-quiz-answer="true"]')
    await field.fill('1.000')
    await student.getByRole('button', { name: 'Lưu câu trả lời' }).click()
    await expect(student.getByText('Em nhập số thập phân bằng dấu phẩy, ví dụ 1,5')).toBeVisible()
    await field.fill('−3/4')
    await student.getByRole('button', { name: 'Lưu câu trả lời' }).click()
    await expect(student.getByText('Đã lưu')).toBeVisible()
    await student.getByRole('button', { name: 'Nộp bài' }).click()
    await expect(student.getByText('Đã hoàn thành').first()).toBeVisible()
    await expect(student.locator('textarea')).toHaveCount(0)
    await expect(student.locator('input:not([data-quiz-answer="true"])')).toHaveCount(0)
    await expect(student.getByRole('textbox', { name: /chat/i })).toHaveCount(0)
    await expectNoSeriousAxe(student)
    await student.setViewportSize({ width: 1280, height: 800 })
    await expectNoSeriousAxe(student)
  } finally {
    setClock('')
    await teacherContext.close()
    await studentContext.close()
  }
})
