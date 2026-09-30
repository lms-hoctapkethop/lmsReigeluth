import { DomainError } from '../errors.ts'
import type { Db, Trx } from '../org/support.ts'

/** Đọc khóa đáp án. Chỉ answerQuestion và submitAttempt được import hàm này. */
export async function readQuestionKey(db: Db | Trx, questionItemId: string): Promise<unknown> {
  const row = await db
    .selectFrom('question_keys')
    .select(['key'])
    .where('question_item_id', '=', questionItemId)
    .executeTakeFirst()
  if (!row) throw new DomainError('NOT_FOUND')
  return row.key
}
