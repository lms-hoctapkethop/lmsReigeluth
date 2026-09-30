import { readFileSync } from 'node:fs'

export type Clock = { now(): Date }

function clockFromEnv(): Date | undefined {
  const file = process.env.HCN_CLOCK_FILE
  const raw = file
    ? (() => {
        try {
          return readFileSync(file, 'utf8').trim()
        } catch {
          return ''
        }
      })()
    : (process.env.HCN_NOW ?? '').trim()
  if (!raw) return undefined
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? undefined : date
}

/** Đồng hồ hệ thống. Kiểm thử E2E ghi ISO vào `HCN_CLOCK_FILE` vì đồng hồ trình duyệt không đổi `available_from`. */
export const systemClock: Clock = {
  now() {
    return clockFromEnv() ?? new Date()
  },
}
