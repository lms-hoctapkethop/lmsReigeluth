import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { startFakeClamd } from '@hcn/testkit/clamd'
import { instreamScan } from '../src/scan.ts'

const eicar = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'

describe('clamd giả', () => {
  let dir = ''

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  it('EICAR thì FOUND, tệp thường thì OK, treo thì hết giờ', async () => {
    dir = await mkdtemp(join(tmpdir(), 'hcn-clamd-'))
    const virus = join(dir, 'eicar.txt')
    const clean = join(dir, 'bai.txt')
    await writeFile(virus, eicar)
    await writeFile(clean, 'print(1)\n')
    const live = await startFakeClamd()
    try {
      expect(await instreamScan(virus, '127.0.0.1', live.port, 2_000)).toBe('infected')
      expect(await instreamScan(clean, '127.0.0.1', live.port, 2_000)).toBe('clean')
      expect(live.hits()).toBe(2)
    } finally {
      await live.close()
    }
    const hung = await startFakeClamd({ hang: true })
    try {
      await expect(instreamScan(clean, '127.0.0.1', hung.port, 200)).rejects.toThrow('CLAMD_TIMEOUT')
    } finally {
      await hung.close()
    }
  })
})
