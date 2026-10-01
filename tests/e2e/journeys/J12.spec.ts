import { expect, test, type APIRequestContext } from '@playwright/test'
import { expectNoSeriousAxe, login, publishReleasedQuiz, publishReleasedRubric, setClock, submitAssignmentText, tin10CourseId, tin10a1OfferingId } from '../helpers.ts'

async function csrf(request: APIRequestContext): Promise<string> {
  const me = await request.get('/api/v1/me')
  expect(me.ok()).toBe(true)
  return ((await me.json()) as { csrfToken: string }).csrfToken
}

async function answerReleasedQuiz(request: APIRequestContext, releaseId: string, itemId: string, submit: boolean): Promise<void> {
  const token = await csrf(request)
  const headers = { 'x-csrf-token': token, 'content-type': 'application/json', origin: 'http://localhost:5173' }
  const started = await request.post(`/api/v1/module-releases/${releaseId}/items/${itemId}/attempts`, {
    headers: { ...headers, 'idempotency-key': crypto.randomUUID() },
    data: {},
  })
  expect(started.ok(), await started.text()).toBe(true)
  const attempt = (await started.json()) as { id: string; questions: { id: string }[] }
  const questionId = attempt.questions[0]?.id ?? ''
  const answered = await request.post(`/api/v1/attempts/${attempt.id}/questions/${questionId}/answers`, {
    headers: { ...headers, 'idempotency-key': crypto.randomUUID() },
    data: { response: { option: 'a' } },
  })
  expect(answered.ok(), await answered.text()).toBe(true)
  if (!submit) return
  const done = await request.post(`/api/v1/attempts/${attempt.id}/submit`, {
    headers: { ...headers, 'idempotency-key': crypto.randomUUID() },
    data: {},
  })
  expect(done.ok(), await done.text()).toBe(true)
}

test('J12 bản đồ nhiệt đổi sau worker, học sinh không thấy giá trị', async ({ browser }) => {
  setClock('2026-09-15T02:00:00.000Z')
  const teacherContext = await browser.newContext()
  const studentContext = await browser.newContext()
  const teacher = await teacherContext.newPage()
  const student = await studentContext.newPage()
  try {
    await login(teacher, 'gv.lan')
    const practice = await publishReleasedQuiz(teacher.request, {
      courseId: tin10CourseId,
      offeringId: tin10a1OfferingId,
      title: 'Luyện tập nhiệt',
      purpose: 'practice',
      kcCode: 'KC-TIN10-CAULENH',
      questions: [{
        clientKey: 'p',
        qtype: 'single_choice',
        stem: { format: 'hcn-rich/1', blocks: [{ type: 'paragraph', children: [{ text: 'Câu luyện tập' }] }] },
        options: [{ id: 'a', label: 'Đúng' }, { id: 'b', label: 'Sai' }],
        answerKey: { option: 'a' },
        bloomTarget: 2,
        hints: ['Đọc lại câu'],
      }],
    })
    const diagnostic = await publishReleasedQuiz(teacher.request, {
      courseId: tin10CourseId,
      offeringId: tin10a1OfferingId,
      title: 'Chẩn đoán nhiệt',
      purpose: 'diagnostic',
      kcCode: 'KC-TIN10-CAULENH',
      questions: [{
        clientKey: 'd',
        qtype: 'single_choice',
        stem: { format: 'hcn-rich/1', blocks: [{ type: 'paragraph', children: [{ text: 'Câu chẩn đoán' }] }] },
        options: [{ id: 'a', label: 'Đúng' }, { id: 'b', label: 'Sai' }],
        answerKey: { option: 'a' },
        bloomTarget: 2,
        hints: [],
      }],
    })
    const rubric = await publishReleasedRubric(teacher.request, 'Bài có KC')
    await login(student, 'hs.minh')
    await answerReleasedQuiz(student.request, practice.releaseId, practice.itemId, false)
    await answerReleasedQuiz(student.request, diagnostic.releaseId, diagnostic.itemId, true)
    await submitAssignmentText(student.request, rubric.releaseId, rubric.itemId, 'Bài của Minh', 0)
    await teacher.goto(`/day/cham/${tin10a1OfferingId}`)
    await teacher.getByRole('link', { name: 'Bài có KC' }).click()
    await teacher.getByRole('heading', { name: 'Rubric' }).click()
    await teacher.keyboard.press('1')
    await teacher.getByRole('button', { name: 'Công bố', exact: true }).click()
    await teacher.getByRole('button', { name: 'Xác nhận công bố' }).click()
    await expect(teacher.getByText('Đã công bố nhận xét.')).toBeVisible()
    await teacher.goto(`/day/lop/${tin10a1OfferingId}`)
    await expect(teacher.getByRole('heading', { name: 'Bản đồ nhiệt' })).toBeVisible()
    await expect(teacher.getByText(/Đang phát triển|Có bằng chứng tốt|Cần hỗ trợ/).first()).toBeVisible({ timeout: 30_000 })
    await expect(teacher.getByText('cập nhật lúc')).toBeVisible()
    await expectNoSeriousAxe(teacher)
    const heatmap = await student.request.get(`/api/v1/offerings/${tin10a1OfferingId}/heatmap`)
    expect(heatmap.status()).toBe(404)
    await student.goto(`/hoc/ho-so/${tin10a1OfferingId}`)
    await expect(student.getByRole('heading', { name: 'Nhu cầu' })).toBeVisible()
    await expect(student.getByRole('heading', { name: 'Kết luận của GV' })).toBeVisible()
    const own = await student.request.get('/api/v1/me')
    const userId = ((await own.json()) as { userId: string }).userId
    await expect.poll(async () => {
      const body = await student.request.get(`/api/v1/learners/${userId}/needs?offeringId=${tin10a1OfferingId}`)
      return body.ok() ? JSON.stringify(await body.json()) : ''
    }, { timeout: 30_000 }).toMatch(/Đang phát triển|Có bằng chứng tốt|Cần hỗ trợ/)
    const latest = await student.request.get(`/api/v1/learners/${userId}/needs?offeringId=${tin10a1OfferingId}`)
    const latestBody = JSON.stringify(await latest.json())
    expect(latestBody).toMatch(/Đang phát triển|Có bằng chứng tốt|Cần hỗ trợ/)
    expect(latestBody).not.toContain('"value"')
  } finally {
    setClock('')
    await teacherContext.close()
    await studentContext.close()
  }
})
