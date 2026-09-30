import { createDb } from '../packages/db/src/index.ts'
import { seedIdentity } from '../packages/testkit/src/identity.ts'

const databaseUrl = process.env.DATABASE_URL
const issuer = process.env.OIDC_ISSUER
if (!databaseUrl || !issuer) {
  console.error('Cấu hình không hợp lệ: DATABASE_URL, OIDC_ISSUER')
  process.exit(1)
}

const db = createDb(databaseUrl)
await seedIdentity(db, { issuer })
await db.destroy()
console.log('Đã nạp persona kiểm thử')
