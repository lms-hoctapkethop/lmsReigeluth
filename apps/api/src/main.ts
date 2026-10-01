import { pathToFileURL } from 'node:url'
import { createDb } from '@hcn/db'
import { ConfigError, loadConfig } from './config.ts'
import { startMetricsServer } from './ops/metrics.ts'
import { buildApp } from './server.ts'

export { buildApp } from './server.ts'

async function main(): Promise<void> {
  try {
    const config = loadConfig()
    const db = createDb(config.databaseUrl)
    const app = await buildApp({ config, db })
    startMetricsServer(db, config.metricsPort, config.backupMetricsFile)
    await app.listen({ port: config.port, host: '0.0.0.0' })
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
