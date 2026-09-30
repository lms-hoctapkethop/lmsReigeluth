// Kiểm thay đổi phá vỡ giữa hai bản OpenAPI 3.1 (thay cho oasdiff: kin-openapi chưa đọc đủ 3.1 nên bước cũ không chạy được).
// Phá vỡ = mất thao tác (path × method), mất mã phản hồi 2xx, thêm tham số hoặc trường body bắt buộc.
// Thao tác có x-milestone (chưa cài) được bỏ qua. Dùng: node scripts/openapi-breaking.mjs base.yaml head.yaml
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'

const methods = ['get', 'post', 'put', 'patch', 'delete']
const load = (file) => parse(readFileSync(file, 'utf8'))
const [baseFile, headFile] = process.argv.slice(2)
if (!baseFile || !headFile) {
  console.error('dùng: node scripts/openapi-breaking.mjs base.yaml head.yaml')
  process.exit(2)
}
const base = load(baseFile)
const head = load(headFile)

function resolve(doc, node) {
  let n = node
  for (let i = 0; n && n.$ref && i < 20; i++) {
    const parts = n.$ref.replace(/^#\//, '').split('/')
    n = parts.reduce((acc, key) => (acc ? acc[key.replace(/~1/g, '/').replace(/~0/g, '~')] : undefined), doc)
  }
  return n
}
function requiredParams(doc, op) {
  return new Set((op.parameters ?? []).map((p) => resolve(doc, p)).filter((p) => p && p.required).map((p) => `${p.in}:${p.name}`))
}
function requiredBody(doc, op) {
  const body = resolve(doc, op.requestBody)
  const schema = resolve(doc, body?.content?.['application/json']?.schema)
  return new Set(body?.required ? (schema?.required ?? []) : [])
}

const problems = []
for (const [path, item] of Object.entries(base.paths ?? {})) {
  for (const method of methods) {
    const before = item?.[method]
    if (!before || before['x-milestone']) continue
    const after = head.paths?.[path]?.[method]
    const id = `${method.toUpperCase()} ${path}`
    if (!after) { problems.push(`${id}: thao tác bị xóa`); continue }
    for (const code of Object.keys(before.responses ?? {})) {
      if (/^2/.test(code) && !(code in (after.responses ?? {}))) problems.push(`${id}: mất phản hồi ${code}`)
    }
    const beforeParams = requiredParams(base, before)
    for (const p of requiredParams(head, after)) if (!beforeParams.has(p)) problems.push(`${id}: thêm tham số bắt buộc ${p}`)
    const beforeBody = requiredBody(base, before)
    for (const f of requiredBody(head, after)) if (!beforeBody.has(f)) problems.push(`${id}: thêm trường body bắt buộc ${f}`)
  }
}
if (problems.length) {
  console.error('Thay đổi phá vỡ API (cần nhãn PR breaking-api và người duyệt, docs/04 mục 6):')
  for (const p of problems) console.error(`- ${p}`)
  process.exit(1)
}
console.log('openapi breaking: không có')
