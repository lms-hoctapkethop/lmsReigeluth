import { gzipSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const dist = new URL('../dist', import.meta.url)
const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8')
const refs = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map((match) => match[1] ?? '')
const initial = refs.filter((href) => !/studio|katex|dnd/i.test(href))
let bytes = 0
for (const href of initial) {
  const path = join(dist.pathname, href.replace(/^\//, ''))
  bytes += gzipSync(readFileSync(path)).length
}
const limit = 250 * 1024
if (bytes >= limit) {
  console.error(`bundle /hoc gzip ${bytes} vượt ${limit}`)
  process.exit(1)
}
console.log(`gzip route /hoc ${bytes} bytes (${initial.length} tệp đầu)`)
