import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('../dist', import.meta.url).pathname
const needle = 'zq-sentinel-7781'

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      walk(path)
      continue
    }
    if (!/\.(html|js|css|map)$/.test(path)) continue
    if (readFileSync(path, 'utf8').includes(needle)) {
      console.error(`lộ khóa trong ${path}`)
      process.exit(1)
    }
  }
}

walk(root)
console.log('HTML, bundle và source map không chứa khóa sentinel')
