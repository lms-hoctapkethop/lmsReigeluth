import { pathToFileURL } from 'node:url'
import { createDb } from '@hcn/db'
import { ConfigError, loadConfig } from './config.ts'
import { buildApp } from './server.ts'

export { buildApp } from './server.ts'

async function main(): Promise<void> {
  try {
    const config = loadConfig()
    const db = createDb(config.databaseUrl)
    const app = await buildApp({ config, db })
    await app.listen({ port: config.port, host: '127.0.0.1' })
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message)
      process.exit(1)
    }
    throw error
  }
}

const entry = process.argv[1]
if (entry && import.meta.url === pathToFileURL(entry).href) {
  await main()
}
