import { writeFileSync } from 'node:fs'
import AxeBuilder from '@axe-core/playwright'
import { expect, type APIRequestContext, type Page } from '@playwright/test'

export const clockFile = '/tmp/hcn-e2e-clock'
export const tin10CourseId = '42000000-0000-4000-8000-000000000001'
export const tin10a1OfferingId = '43000000-0000-4000-8000-000000000001'
export const toan7CourseId = '42000000-0000-4000-8000-000000000003'
export const toan7a4OfferingId = '43000000-0000-4000-8000-000000000004'

export function setClock(iso: string): void {
  writeFileSync(clockFile, iso)
}

export async function expectNoSeriousAxe(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).analyze()
  const blocking = result.violations.filter((item) => item.impact === 'serious' || item.impact === 'critical')
  expect(blocking).toEqual([])
}

export async function login(page: Page, username: string): Promise<void> {
  await page.goto('/login-required?returnTo=/')
  await page.getByRole('button', { name: 'Đăng nhập' }).click()
  await page.locator('#username').fill(username)
  await page.locator('#password').fill('Dev-12345')
  await page.locator('#kc-login').click()
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 })
}

async function csrf(request: APIRequestContext): Promise<string> {
  const me = await request.get('/api/v1/me')
  expect(me.ok()).toBe(true)
  const body = (await me.json()) as { csrfToken: string }
  return body.csrfToken
}

export async function publishReleasedAssignment(
  request: APIRequestContext,
  title: string,
  availableFrom: string,
): Promise<{ releaseId: string; itemId: string }> {
  const token = await csrf(request)
  const headers = { 'x-csrf-token': token, 'content-type': 'application/json', origin: 'http://localhost:5173' }
  const created = await request.post('/api/v1/modules', { headers, data: { courseId: tin10CourseId, title, requirementIds: [] } })
  expect(created.ok(), await created.text()).toBe(true)
  const moduleId = ((await created.json()) as { moduleId: string }).moduleId
  const draft = await request.put(`/api/v1/modules/${moduleId}/draft`, {
    headers: { ...headers, 'if-match': 'W/"1"' },
    data: {
      schema: 'module-draft/1',
      title,
      requirementIds: [],
      items: [{
        clientKey: 'a',
        type: 'assignment',
        title,
        indent: 0,
        completion: 'submit',
        body: { format: 'hcn-rich/1', blocks: [{ type: 'paragraph', children: [{ text: 'Làm bài' }] }] },
        requirementIds: [],
      }],
    },
  })
  expect(draft.ok(), await draft.text()).toBe(true)
  const published = await request.post(`/api/v1/modules/${moduleId}/versions`, {
    headers: { ...headers, 'idempotency-key': crypto.randomUUID() },
    data: { expectedRevision: 2, acknowledgements: [] },
  })
  expect(published.ok(), await published.text()).toBe(true)
  const versionId = ((await published.json()) as { id: string }).id
  const released = await request.post(`/api/v1/offerings/${tin10a1OfferingId}/path-releases`, {
    headers: { ...headers, 'idempotency-key': crypto.randomUUID() },
    data: {
      title,
      modules: [{ moduleVersionId: versionId, availableFrom, dueAt: '2099-01-01T00:00:00.000Z' }],
    },
  })
  expect(released.ok(), await released.text()).toBe(true)
  const releaseId = ((await released.json()) as { moduleReleaseIds: string[] }).moduleReleaseIds[0] ?? ''
  const detail = await request.get(`/api/v1/module-releases/${releaseId}`)
  expect(detail.ok(), await detail.text()).toBe(true)
  const items = ((await detail.json()) as { items: { id: string; itemType: string }[] }).items
  const itemId = items.find((item) => item.itemType === 'assignment')?.id ?? ''
  return { releaseId, itemId }
}

type Catalog = {
  requirements: { id: string; reviewStatus: string }[]
  kcs: { id: string; code: string }[]
  misconceptions: { id: string; code: string; description: string }[]
  links: { requirementId: string; kcVersionId: string }[]
}

export async function publishReleasedQuiz(
  request: APIRequestContext,
  input: {
    courseId: string
    offeringId: string
    title: string
    purpose: 'practice' | 'diagnostic' | 'exit_ticket'
    kcCode: string
    questions: Record<string, unknown>[]
    showFeedback?: string
  },
): Promise<{ releaseId: string; itemId: string }> {
  const token = await csrf(request)
  const headers = { 'x-csrf-token': token, 'content-type': 'application/json', origin: 'http://localhost:5173' }
  const catalogResponse = await request.get(`/api/v1/authoring/catalog?courseId=${input.courseId}`)
  expect(catalogResponse.ok(), await catalogResponse.text()).toBe(true)
  const catalog = (await catalogResponse.json()) as Catalog
  const kc = catalog.kcs.find((row) => row.code === input.kcCode)
  const link = catalog.links.find((row) => row.kcVersionId === kc?.id)
  expect(kc && link).toBeTruthy()
  const questions = input.questions.map((question) => ({ ...question, kcObservable: [kc?.id], kcRequired: [] }))
  const created = await request.post('/api/v1/modules', {
    headers,
    data: { courseId: input.courseId, title: input.title, requirementIds: [link?.requirementId] },
  })
  expect(created.ok(), await created.text()).toBe(true)
  const moduleId = ((await created.json()) as { moduleId: string }).moduleId
  const draft = await request.put(`/api/v1/modules/${moduleId}/draft`, {
    headers: { ...headers, 'if-match': 'W/"1"' },
    data: {
      schema: 'module-draft/1',
      title: input.title,
      requirementIds: [link?.requirementId],
      items: [{
        clientKey: 'q',
        type: 'quiz',
        title: input.title,
        indent: 0,
        completion: 'submit',
        assessment: {
          purpose: input.purpose,
          maxAttempts: input.purpose === 'practice' ? null : 1,
          showFeedback: input.showFeedback ?? (input.purpose === 'practice' ? 'immediate' : 'after_submit'),
          hintsEnabled: input.purpose === 'practice',
          shuffleOptions: false,
          questions,
        },
      }],
    },
  })
  expect(draft.ok(), await draft.text()).toBe(true)
  const published = await request.post(`/api/v1/modules/${moduleId}/versions`, {
    headers: { ...headers, 'idempotency-key': crypto.randomUUID() },
    data: { expectedRevision: 2, acknowledgements: [] },
  })
  expect(published.ok(), await published.text()).toBe(true)
  const versionId = ((await published.json()) as { id: string }).id
  const released = await request.post(`/api/v1/offerings/${input.offeringId}/path-releases`, {
    headers: { ...headers, 'idempotency-key': crypto.randomUUID() },
    data: { title: input.title, modules: [{ moduleVersionId: versionId, availableFrom: '2020-01-01T00:00:00.000Z' }] },
  })
  expect(released.ok(), await released.text()).toBe(true)
  const releaseId = ((await released.json()) as { moduleReleaseIds: string[] }).moduleReleaseIds[0] ?? ''
  const detail = await request.get(`/api/v1/module-releases/${releaseId}`)
  expect(detail.ok(), await detail.text()).toBe(true)
  const items = ((await detail.json()) as { items: { id: string; itemType: string }[] }).items
  return { releaseId, itemId: items.find((item) => item.itemType === 'quiz')?.id ?? '' }
}
