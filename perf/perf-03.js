import http from 'k6/http'
import { ensureLogin, hostOptions, ok, readJson } from './lib/session.js'

export const options = hostOptions({
  scenarios: {
    submit: { executor: 'shared-iterations', vus: 200, iterations: 200, maxDuration: '60s' },
  },
  thresholds: {
    http_req_failed: ['rate<0.005'],
    http_req_duration: ['p(95)<1500'],
  },
})

export default function () {
  ensureLogin('student')
  const base = __ENV.BASE_URL
  const today = http.get(`${base}/api/v1/me/today`)
  ok(today, 'today')
  const body = readJson(today)
  const item = body && body.items && body.items.find((row) => row.itemType === 'assignment')
  if (!item) return
  const draft = http.put(
    `${base}/api/v1/module-releases/${item.releaseId}/items/${item.itemId}/submission/draft`,
    JSON.stringify({ body: { type: 'text', text: `nộp ${__VU}` } }),
    { headers: { 'Content-Type': 'application/json', 'If-Match': 'W/"0"' } },
  )
  ok(draft, 'draft')
  const saved = readJson(draft)
  const submitted = http.post(
    `${base}/api/v1/module-releases/${item.releaseId}/items/${item.itemId}/submissions`,
    JSON.stringify({ draftRevision: saved ? saved.draftRevision : 1 }),
    { headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `perf03-${__VU}` } },
  )
  ok(submitted, 'submit')
}
