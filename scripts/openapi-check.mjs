import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import SwaggerParser from '@apidevtools/swagger-parser'

const file = fileURLToPath(new URL('../openapi/openapi.yaml', import.meta.url))
const text = readFileSync(file, 'utf8')
let document
try {
  document = parse(text, { uniqueKeys: true })
} catch (error) {
  console.error(file)
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
try {
  await SwaggerParser.validate(document)
} catch (error) {
  console.error(file)
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
console.log('openapi ok')
