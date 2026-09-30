import net from 'node:net'

const eicar = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'
const host = process.env.CLAMD_HOST ?? '127.0.0.1'
const port = Number(process.env.CLAMD_PORT ?? '3310')

const reply = await new Promise((resolve, reject) => {
  const socket = net.connect({ host, port })
  const chunks = []
  socket.setTimeout(30_000, () => {
    socket.destroy()
    reject(new Error('CLAMD_TIMEOUT'))
  })
  socket.on('error', reject)
  socket.on('data', (buf) => chunks.push(buf))
  socket.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  socket.on('connect', () => {
    const body = Buffer.from(eicar)
    const length = Buffer.alloc(4)
    length.writeUInt32BE(body.length, 0)
    socket.end(Buffer.concat([Buffer.from('zINSTREAM\0'), length, body, Buffer.alloc(4)]))
  })
})

if (!reply.includes('FOUND')) {
  console.error(reply)
  process.exit(1)
}
console.log('scan-real EICAR FOUND')
