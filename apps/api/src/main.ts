import { pathToFileURL } from 'node:url'
import Fastify, { type FastifyInstance } from 'fastify'

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false })
  app.get('/health/live', async () => ({ status: 'live' }))
  return app
}

const entry = process.argv[1]
if (entry && import.meta.url === pathToFileURL(entry).href) {
  const port = Number(process.env.PORT ?? 4319)
  const app = buildApp()
  await app.listen({ port, host: '127.0.0.1' })
}
