import { readFileSync } from 'node:fs'

const text = readFileSync(new URL('../openapi/openapi.yaml', import.meta.url), 'utf8')
if (!text.includes('openapi: 3.1.0')) {
  console.error('openapi/openapi.yaml phải khai báo openapi: 3.1.0')
  process.exit(1)
}
if (!text.includes('\npaths:')) {
  console.error('openapi/openapi.yaml thiếu mục paths')
  process.exit(1)
}
console.log('openapi ok')
