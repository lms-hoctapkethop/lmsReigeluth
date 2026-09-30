import pino, { type DestinationStream } from 'pino'

export function loggedUrl(url: string): string {
  const path = url.split('?')[0] ?? url
  return path.startsWith('/auth/callback') ? path : url
}

export function createLogger(stream?: DestinationStream) {
  const options = {
      level: stream ? 'info' : 'silent',
      redact: {
        paths: [
          'req.headers.cookie',
          'req.headers.authorization',
          'req.headers["x-csrf-token"]',
          'res.headers["set-cookie"]',
          'body',
          '*.body',
          'text',
          '*.text',
          'comment',
          '*.comment',
          'reflection',
          '*.reflection',
          'id_token',
          '*.id_token',
          'idToken',
          '*.idToken',
        ],
        censor: '[Redacted]',
      },
      serializers: {
        req(request: { method?: string; url?: string }) {
          const url = request.url ?? ''
          return { method: request.method, url: loggedUrl(url) }
        },
      },
  }
  return stream ? pino(options, stream) : pino(options)
}
