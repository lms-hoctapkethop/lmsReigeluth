import net from 'node:net'

export type FakeClamd = {
  port: number
  hits: () => number
  close: () => Promise<void>
}

/** TCP clamd giả: INSTREAM, EICAR → FOUND, còn lại OK. `hang` không trả lời để thử timeout. */
export function startFakeClamd(options?: { hang?: boolean }): Promise<FakeClamd> {
  let hits = 0
  const sockets = new Set<net.Socket>()
  const server = net.createServer((socket) => {
    hits += 1
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    if (options?.hang) return
    let buf = Buffer.alloc(0)
    let mode: 'cmd' | 'len' | 'data' = 'cmd'
    let need = 0
    const file: Buffer[] = []
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk])
      for (;;) {
        if (mode === 'cmd') {
          const end = buf.indexOf(0)
          if (end < 0) return
          buf = buf.subarray(end + 1)
          mode = 'len'
          continue
        }
        if (mode === 'len') {
          if (buf.length < 4) return
          need = buf.readUInt32BE(0)
          buf = buf.subarray(4)
          if (need === 0) {
            const text = Buffer.concat(file).toString('latin1')
            const reply = text.includes('EICAR') ? 'stream: Eicar-Test-Signature FOUND\0' : 'stream: OK\0'
            socket.end(reply)
            return
          }
          mode = 'data'
          continue
        }
        if (buf.length < need) return
        file.push(buf.subarray(0, need))
        buf = buf.subarray(need)
        mode = 'len'
      }
    })
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({
        port,
        hits: () => hits,
        close: () => new Promise((done, fail) => {
          for (const socket of sockets) socket.destroy()
          server.close((error) => (error ? fail(error) : done()))
        }),
      })
    })
  })
}
