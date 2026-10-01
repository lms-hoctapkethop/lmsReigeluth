/** Mặc định tắt. Không có đường gọi LLM khi cờ này là false. */
export function featureAiEnabled(env: { FEATURE_AI?: string } = process.env): boolean {
  return env.FEATURE_AI === 'true'
}
