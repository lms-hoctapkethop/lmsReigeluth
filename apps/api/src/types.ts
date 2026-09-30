import type { Role } from '@hcn/domain'

export type RequestAuth = {
  sessionHash: string
  userId: string
  displayName: string
  schoolId: string
  role: Role
  roles: Role[]
  csrfToken: string
  idTokenHint: string | null
}

export type RegisteredRoute = {
  method: string
  url: string
  isPublic: boolean
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: RequestAuth | null
  }
  interface FastifyInstance {
    registeredRoutes: RegisteredRoute[]
  }
  interface FastifyContextConfig {
    public?: boolean
  }
}
