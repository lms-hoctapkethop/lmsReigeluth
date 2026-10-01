import http from 'k6/http'
import { sleep } from 'k6'
import { ensureLogin, hostOptions, ok, readJson } from './lib/session.js'

const attempt = {}

export const options = hostOptions({
  vus: 150,
  duration: '5m',
  thresholds: {
    http_req_failed: ['rate<0.005'],
    http_req_duration: ['p(95)<600'],
  },
})

export default function () {
  ensureLogin('student')
  const base = __ENV.BASE_URL
  const today = http.get(`${base}/api/v1/me/today`)
  ok(today, 'today')
  const body = readJson(today)
  const item = body && body.items && body.items.find((row) => row.itemType === 'quiz')
  if (!item) return
  if (!attempt[__VU]) {
    const started = http.post(
      `${base}/api/v1/module-releases/${item.releaseId}/items/${item.itemId}/attempts`,
      null,
      { headers: { 'Idempotency-Key': `perf04-start-${__VU}` } },
    )
    ok(started, 'start')
    const view = readJson(started)
    const question = view && view.questions && view.questions[0]
    if (view && view.id && question) attempt[__VU] = { id: view.id, questionId: question.id, releaseId: item.releaseId, itemId: item.itemId }
  }
  const current = attempt[__VU]
  if (!current) return
  const answered = http.post(
    `${base}/api/v1/attempts/${current.id}/questions/${current.questionId}/answers`,
    JSON.stringify({ response: { raw: '1' } }),
    { headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `perf04-answer-${__VU}-${__ITER}` } },
  )
  ok(answered, 'answer')
  sleep(5)
}
