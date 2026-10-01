import http from 'k6/http'
import { sleep } from 'k6'
import { ensureLogin, hostOptions, ok, readJson } from './lib/session.js'

export const options = hostOptions({
  vus: 20,
  duration: '3m',
  thresholds: {
    http_req_failed: ['rate<0.005'],
    http_req_duration: ['p(95)<1200'],
  },
})

export default function () {
  ensureLogin('teacher')
  const base = __ENV.BASE_URL
  const listed = http.get(`${base}/api/v1/offerings`)
  ok(listed, 'offerings')
  const rows = readJson(listed)
  const offering = Array.isArray(rows) ? rows[0] : null
  if (!offering) return
  ok(http.get(`${base}/api/v1/offerings/${offering.id}/review-queue`), 'review-queue')
  ok(http.get(`${base}/api/v1/offerings/${offering.id}/heatmap`), 'heatmap')
  sleep(2)
}
