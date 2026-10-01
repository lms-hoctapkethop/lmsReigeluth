import http from 'k6/http'

const password = open('/secrets/synthetic_user_password').trim()
const sessions = {}

function decode(value) {
  return value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
}

export function ensureLogin(role) {
  if (sessions[__VU]) return sessions[__VU]
  const username = role === 'teacher'
    ? `stg.gv${String(__VU).padStart(3, '0')}`
    : `stg.hs${String(__VU).padStart(4, '0')}`
  const base = __ENV.BASE_URL
  const start = http.get(`${base}/auth/login?returnTo=/`, { redirects: 0 })
  const location = start.headers.Location || start.headers.location
  if (!location) throw new Error('không có chuyển hướng đăng nhập')
  const formPage = http.get(location)
  const match = String(formPage.body).match(/<form[^>]*action="([^"]+)"/i)
  if (!match) throw new Error('không thấy action của form')
  const action = decode(match[1])
  http.post(action, { username, password }, { redirects: 5 })
  const names = Object.keys(http.cookieJar().cookiesForURL(base))
  if (!names.includes('hcn_sid')) throw new Error('thiếu cookie hcn_sid')
  sessions[__VU] = username
  return username
}
