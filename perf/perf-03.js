import http from 'k6/http'
import { sleep } from 'k6'

export const options = {
  scenarios: {
    submit: { executor: 'shared-iterations', vus: 200, iterations: 200, maxDuration: '60s' },
  },
  thresholds: { http_req_duration: ['p(95)<1500'] },
}

export default function () {
  http.get(`${__ENV.BASE_URL}/hoc`)
  sleep(1)
}
