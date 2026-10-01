import { check } from 'k6'
export { ensureLogin } from './login.js'

export function ok(response, name) {
  return check(response, { [name]: (response) => response.status >= 200 && response.status < 300 })
}

export function readJson(response) {
  try {
    return response.json()
  } catch {
    return null
  }
}

export function hostOptions(extra) {
  const app = __ENV.APP_DOMAIN || 'staging-lms.hoctapkethop.edu.vn'
  const id = __ENV.ID_DOMAIN || 'id-staging-lms.hoctapkethop.edu.vn'
  return {
    insecureSkipTLSVerify: true,
    hosts: { [app]: '127.0.0.1', [id]: '127.0.0.1' },
    ...extra,
  }
}
