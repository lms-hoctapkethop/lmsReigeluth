/** Sinh lại bằng `pnpm db:types` khi DATABASE_URL trỏ tới DB đã migrate. */
export interface Database {
  [table: string]: never
}
