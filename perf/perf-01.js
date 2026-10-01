import http from 'k6/http'
import { sleep } from 'k6'
import { ensureLogin, hostOptions, ok, readJson } from './lib/session.js'

export const options = hostOptions({
  vus: 200,
  duration: '10m',
  thresholds: {
    http_req_failed: ['rate<0.005'],
    http_req_duration: ['p(95)<800'],
  },
})

export default function () {
  ensureLogin('student')
  const base = __ENV.BASE_URL
  ok(http.get(`${base}/api/v1/me`), 'me')
  const today = http.get(`${base}/api/v1/me/today`)
  ok(today, 'today')
  const body = readJson(today)
  const item = body && body.items && body.items[0]
  if (item) {
    ok(http.get(`${base}/api/v1/module-releases/${item.releaseId}`), 'release')
    ok(http.post(`${base}/api/v1/module-releases/${item.releaseId}/items/${item.itemId}/view`, null), 'item')
  }
  sleep(1)
}
