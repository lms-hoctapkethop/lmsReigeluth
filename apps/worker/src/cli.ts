import { pathToFileURL } from 'node:url'
import { createDb } from '@hcn/db'
import { backfillInsights } from './insight/backfill.ts'
import { recomputeAll } from './insight/recompute.ts'

export async function runInsightCommand(argv: string[], databaseUrl: string): Promise<void> {
  const db = createDb(databaseUrl)
  try {
    const command = argv[2]
    if (command === 'backfill') {
      const result = await backfillInsights(db)
      console.log(`backfill observations+${String(result.observations)} estimates+${String(result.estimates)}`)
      return
    }
    if (command === 'recompute') {
      const index = argv.indexOf('--model')
      const model = argv[index + 1]
      if (!model || index < 0) {
        console.error('Thiếu --model')
        process.exitCode = 1
        return
      }
      const inserted = await recomputeAll(db, model)
      console.log(`recompute ${model} rows+${String(inserted)}`)
      return
    }
    console.error('Lệnh: backfill | recompute --model <ver>')
    process.exitCode = 1
  } finally {
    await db.destroy()
  }
}

const entry = process.argv[1]
if (entry && import.meta.url === pathToFileURL(entry).href) {
  const databaseUrl = process.env.WORKER_DATABASE_URL
  if (!databaseUrl) {
    console.error('Cấu hình không hợp lệ: WORKER_DATABASE_URL')
    process.exit(1)
  }
  await runInsightCommand(process.argv, databaseUrl)
}
