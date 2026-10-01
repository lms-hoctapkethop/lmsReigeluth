import http from 'k6/http'
import { check, sleep } from 'k6'
import { login } from './lib/login.js'

export const options = {
  vus: 200,
  duration: '10m',
  thresholds: {
    http_req_failed: ['rate<0.005'],
    http_req_duration: ['p(95)<800'],
  },
}

export default function () {
  const base = __ENV.BASE_URL
  login(base, __ENV.USERNAME, __ENV.PASSWORD)
  const today = http.get(`${base}/hoc`)
  check(today, { 'hôm nay': (response) => response.status < 500 })
  sleep(1)
}
