import http from 'k6/http'
import { sleep } from 'k6'
import { ensureLogin, hostOptions, ok, readJson } from './lib/session.js'

const revision = {}

export const options = hostOptions({
  vus: 200,
  duration: '10m',
  thresholds: {
    http_req_failed: ['rate<0.005'],
    http_req_duration: ['p(95)<1000'],
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
  const current = revision[__VU] ?? 0
  const saved = http.put(
    `${base}/api/v1/module-releases/${item.releaseId}/items/${item.itemId}/submission/draft`,
    JSON.stringify({ body: { type: 'text', text: `nháp ${__ITER}` } }),
    { headers: { 'Content-Type': 'application/json', 'If-Match': `W/"${current}"` } },
  )
  ok(saved, 'draft')
  const etag = saved.headers.Etag || saved.headers.etag || ''
  const match = String(etag).match(/(\d+)/)
  if (match) revision[__VU] = Number(match[1])
  sleep(10)
}
