import { mkdirSync, writeFileSync } from 'node:fs'

mkdirSync(new URL('../dist', import.meta.url), { recursive: true })
writeFileSync(new URL('../dist/index.html', import.meta.url), '<!doctype html><title>Học cùng nhau</title>\n')
