import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { createDb } from '@hcn/db'
import { startWorker } from './loop.ts'

export const workerMilestone = 'M8'
export { processOutbox, cleanupExpired, startWorker, commitConsumer, acknowledgeOutbox } from './loop.ts'
export { runDueSoon } from './due-soon.ts'
export { instreamScan } from './scan.ts'

const entry = process.argv[1]
if (entry && import.meta.url === pathToFileURL(entry).href) {
  const databaseUrl = process.env.WORKER_DATABASE_URL
  if (!databaseUrl) {
    console.error('Cấu hình không hợp lệ: WORKER_DATABASE_URL')
    process.exit(1)
  }
  const healthPort = process.env.WORKER_HEALTH_PORT
  if (healthPort) {
    createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' })
      response.end('ok')
    }).listen(Number(healthPort), '127.0.0.1')
  }
  const db = createDb(databaseUrl)
  startWorker(db, {
    storageDir: process.env.FILE_STORAGE_DIR ?? '/tmp/hcn-files',
    clamdHost: process.env.CLAMD_HOST ?? '127.0.0.1',
    clamdPort: Number(process.env.CLAMD_PORT ?? '3310'),
  })
}
