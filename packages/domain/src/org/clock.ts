import { readFileSync } from 'node:fs'

export type Clock = { now(): Date }

const fileCacheMs = 1000
let fileCache: { path: string; at: number; raw: string } | undefined

/** Đồng hồ giả chỉ khi test hoặc khi E2E bật cờ. Production không đọc tệp hay HCN_NOW. */
export function clockOverrideEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'test' || env.HCN_TEST_CLOCK === '1'
}

function readClockFile(path: string): string {
  const at = Date.now()
  if (fileCache && fileCache.path === path && at - fileCache.at < fileCacheMs) return fileCache.raw
  let raw = ''
  try {
    raw = readFileSync(path, 'utf8').trim()
  } catch {
    raw = ''
  }
  fileCache = { path, at, raw }
  return raw
}

function clockFromEnv(env: NodeJS.ProcessEnv): Date | undefined {
  if (!clockOverrideEnabled(env)) return undefined
  const file = env.HCN_CLOCK_FILE
  const raw = file ? readClockFile(file) : (env.HCN_NOW ?? '').trim()
  if (!raw) return undefined
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? undefined : date
}

/** Đồng hồ hệ thống. E2E ghi ISO vào HCN_CLOCK_FILE và đặt HCN_TEST_CLOCK=1. */
export const systemClock: Clock = {
  now() {
    return clockFromEnv(process.env) ?? new Date()
  },
}

export function resetClockCache(): void {
  fileCache = undefined
}
