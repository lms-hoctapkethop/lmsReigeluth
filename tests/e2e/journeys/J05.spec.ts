import { expect, test } from '@playwright/test'
import { expectNoSeriousAxe, login, publishReleasedQuiz, setClock, tin10a1OfferingId, tin10CourseId } from '../helpers.ts'

test('J05 hs.minh luyện tập, xem gợi ý và nộp', async ({ browser }) => {
  setClock(new Date().toISOString())
  const teacherContext = await browser.newContext()
  const studentContext = await browser.newContext()
  const teacher = await teacherContext.newPage()
  const student = await studentContext.newPage()
  try {
    await login(teacher, 'gv.lan')
    const catalog = await teacher.request.get(`/api/v1/authoring/catalog?courseId=${tin10CourseId}`)
    expect(catalog.ok()).toBe(true)
    const body = (await catalog.json()) as { misconceptions: { id: string; code: string; description: string }[] }
    const misconception = body.misconceptions.find((row) => row.code === 'M-TIN10-CAULENH')
    expect(misconception?.id).toBeTruthy()
    const released = await publishReleasedQuiz(teacher.request, {
      courseId: tin10CourseId,
      offeringId: tin10a1OfferingId,
      title: 'Luyện tập lệnh',
      purpose: 'practice',
      kcCode: 'KC-TIN10-CAULENH',
      questions: [{
        clientKey: 'q1',
        qtype: 'single_choice',
        stem: { format: 'hcn-rich/1', blocks: [{ type: 'paragraph', children: [{ text: 'Phép gán viết thế nào?' }] }] },
        options: [{ id: 'b', label: '3.5' }, { id: 'a', label: 'Lệnh gán' }],
        answerKey: { option: 'a' },
        bloomTarget: 2,
        hints: ['Nhìn lại dấu bằng.', 'Một dấu bằng là phép gán.'],
        optionMisconceptions: { b: misconception?.id },
      }],
    })
    await login(student, 'hs.minh')
    await student.setViewportSize({ width: 360, height: 800 })
    await student.goto(`/hoc/bai/${released.releaseId}`)
    await expect(student.getByRole('heading', { level: 1, name: 'Luyện tập lệnh' })).toBeVisible()
    await student.getByRole('button', { name: '3.5' }).click()
    await expect(student.getByText(misconception?.description ?? '')).toBeVisible()
    await student.getByRole('button', { name: 'Xem gợi ý 1' }).click()
    await expect(student.getByText('Nhìn lại dấu bằng.')).toBeVisible()
    await student.getByRole('button', { name: 'Xem gợi ý 2' }).click()
    await expect(student.getByText('Một dấu bằng là phép gán.')).toBeVisible()
    await student.getByRole('button', { name: 'Lệnh gán' }).click()
    await expect(student.getByText('Đúng')).toBeVisible()
    await student.getByRole('button', { name: 'Nộp bài' }).click()
    await expect(student.getByText('Đã hoàn thành').first()).toBeVisible()
    await expectNoSeriousAxe(student)
    await student.setViewportSize({ width: 1280, height: 800 })
    await expectNoSeriousAxe(student)
  } finally {
    setClock('')
    await teacherContext.close()
    await studentContext.close()
  }
})
