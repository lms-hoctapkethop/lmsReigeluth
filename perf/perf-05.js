import http from 'k6/http'
import { sleep } from 'k6'

export const options = {
  vus: 20,
  duration: '3m',
  thresholds: { http_req_duration: ['p(95)<1200'] },
}

export default function () {
  http.get(`${__ENV.BASE_URL}/day`)
  sleep(2)
}
