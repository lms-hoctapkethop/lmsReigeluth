export function crashAfterCommit(command: string): void {
  if (process.env.HCN_ENV !== 'test') return
  if (process.env.HCN_FAULT_AFTER_COMMIT !== command) return
  process.exit(1)
}
