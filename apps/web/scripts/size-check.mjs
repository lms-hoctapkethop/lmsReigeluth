import { gzipSync } from 'node:zlib'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('../dist', import.meta.url)
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path, out)
    else out.push(path)
  }
  return out
}
const files = walk(root.pathname)
const bytes = files.reduce((sum, file) => sum + gzipSync(readFileSync(file)).length, 0)
const limit = 250 * 1024
if (bytes >= limit) {
  console.error(`bundle gzip ${bytes} vượt ${limit}`)
  process.exit(1)
}
console.log(`gzip ${bytes} bytes`)
