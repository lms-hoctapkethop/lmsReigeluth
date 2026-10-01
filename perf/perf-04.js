import http from 'k6/http'
import { sleep } from 'k6'

export const options = {
  vus: 150,
  duration: '5m',
  thresholds: { http_req_duration: ['p(95)<600'] },
}

export default function () {
  http.get(`${__ENV.BASE_URL}/hoc`)
  sleep(5)
}
