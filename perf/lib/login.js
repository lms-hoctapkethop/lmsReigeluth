import http from 'k6/http'

export function login(baseUrl, username, password) {
  const page = http.get(`${baseUrl}/login-required?returnTo=/`)
  const start = http.get(`${baseUrl}/auth/login?returnTo=/`, { redirects: 0 })
  const location = start.headers.Location || start.headers.location
  if (!location) return page
  const form = http.get(location)
  return http.post(form.url, { username, password }, { redirects: 5 })
}
