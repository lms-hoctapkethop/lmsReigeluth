import { readFileSync } from 'node:fs'
import { z } from 'zod'

export class ConfigError extends Error {
  constructor(variables: string[]) {
    super(`Cấu hình không hợp lệ: ${variables.join(', ')}`)
    this.name = 'ConfigError'
  }
}

const httpUrl = z.string().refine((value) => {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
})

const cidr = z.string().regex(/^(?:\d{1,3}\.){3}\d{1,3}(?:\/(?:3[0-2]|[12]?\d))?$|^[0-9a-fA-F:]+(?:\/(?:12[0-8]|1[01]\d|\d{1,2}))?$/)

const schema = z.object({
  appOrigin: httpUrl,
  databaseUrl: z.string().min(1),
  oidcIssuer: httpUrl,
  oidcClientId: z.string().min(1),
  oidcClientSecret: z.string().min(1),
  cookieSecret: z.string().min(32),
  sessionTtlHours: z.coerce.number().int().positive(),
  sessionMaxDays: z.coerce.number().int().positive(),
  trustProxy: z.array(cidr),
  port: z.coerce.number().int().positive(),
  keycloakProvisionerClientId: z.string().min(1).optional(),
  keycloakProvisionerSecret: z.string().min(1).optional(),
})

export type AppConfig = z.infer<typeof schema>

const envByField: Record<string, string> = {
  appOrigin: 'APP_ORIGIN',
  databaseUrl: 'DATABASE_URL',
  oidcIssuer: 'OIDC_ISSUER',
  oidcClientId: 'OIDC_CLIENT_ID',
  oidcClientSecret: 'OIDC_CLIENT_SECRET',
  cookieSecret: 'COOKIE_SECRET',
  sessionTtlHours: 'SESSION_TTL_HOURS',
  sessionMaxDays: 'SESSION_MAX_DAYS',
  trustProxy: 'TRUST_PROXY',
  port: 'PORT',
  keycloakProvisionerClientId: 'KEYCLOAK_PROVISIONER_CLIENT_ID',
  keycloakProvisionerSecret: 'KEYCLOAK_PROVISIONER_SECRET',
}

function readSecret(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const fileKey = `${name}_FILE`
  const hasFile = env[fileKey] !== undefined
  const hasDirect = env[name] !== undefined
  if (hasFile && hasDirect) throw new ConfigError([name])
  if (hasFile) {
    const path = env[fileKey]
    if (!path) throw new ConfigError([name])
    try {
      return readFileSync(path, 'utf8').trim()
    } catch {
      throw new ConfigError([name])
    }
  }
  return env[name]
}

const clockSchema = z
  .object({
    nodeEnv: z.string().optional(),
    clockFile: z.string().optional(),
    clockNow: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.nodeEnv !== 'production') return
    if (value.clockFile !== undefined) ctx.addIssue({ code: 'custom', path: ['HCN_CLOCK_FILE'], message: 'HCN_CLOCK_FILE' })
    if (value.clockNow !== undefined) ctx.addIssue({ code: 'custom', path: ['HCN_NOW'], message: 'HCN_NOW' })
  })

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const clock = clockSchema.safeParse({
    nodeEnv: env.NODE_ENV,
    clockFile: env.HCN_CLOCK_FILE,
    clockNow: env.HCN_NOW,
  })
  if (!clock.success) {
    const names = [
      ...new Set(
        clock.error.issues
          .map((issue) => issue.path[0])
          .filter((item): item is string => typeof item === 'string'),
      ),
    ]
    throw new ConfigError(names.length > 0 ? names : ['HCN_CLOCK_FILE'])
  }
  const trustProxy = (env.TRUST_PROXY ?? '').split(',').map((item) => item.trim()).filter((item) => item.length > 0)
  const parsed = schema.safeParse({
    appOrigin: env.APP_ORIGIN?.replace(/\/$/, ''),
    databaseUrl: readSecret(env, 'DATABASE_URL'),
    oidcIssuer: env.OIDC_ISSUER?.replace(/\/$/, ''),
    oidcClientId: env.OIDC_CLIENT_ID,
    oidcClientSecret: readSecret(env, 'OIDC_CLIENT_SECRET'),
    cookieSecret: readSecret(env, 'COOKIE_SECRET'),
    sessionTtlHours: env.SESSION_TTL_HOURS ?? '12',
    sessionMaxDays: env.SESSION_MAX_DAYS ?? '7',
    trustProxy,
    port: env.PORT ?? '4319',
    keycloakProvisionerClientId: env.KEYCLOAK_PROVISIONER_CLIENT_ID,
    keycloakProvisionerSecret: readSecret(env, 'KEYCLOAK_PROVISIONER_SECRET'),
  })
  if (!parsed.success) {
    const names = [
      ...new Set(
        parsed.error.issues
          .map((issue) => issue.path[0])
          .filter((item): item is string => typeof item === 'string')
          .map((item) => envByField[item] ?? item),
      ),
    ]
    throw new ConfigError(names.length > 0 ? names : ['config'])
  }
  return parsed.data
}
