import { UserError } from '@missionsquad/fastmcp'
import dotenv from 'dotenv'
import { z } from 'zod'

dotenv.config()

const DEFAULT_SQL_ENDPOINT = '/mcp/v1/query'

const EnvSchema = z.object({
  WORDPRESS_API_URL: z.string().optional(),
  WORDPRESS_USERNAME: z.string().optional(),
  WORDPRESS_PASSWORD: z.string().optional(),
  WORDPRESS_SQL_ENDPOINT: z.string().optional(),
})

export interface SingleSiteCredentials {
  siteUrl: string
  username: string
  password: string
}

export interface AppConfig {
  fallbackSite?: SingleSiteCredentials
  defaultSqlEndpoint: string
}

export interface ResolvedWordPressRequestConfig {
  site: SingleSiteCredentials
  sqlEndpoint: string
}

function readOptionalEnvString(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : undefined
}

function hasAnyLegacyMultiSiteEnv(source: NodeJS.ProcessEnv): boolean {
  return Object.keys(source).some((key) => /^WORDPRESS_\d+_/.test(key))
}

function normalizeSiteUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim()
  if (trimmed.length === 0) {
    throw new UserError('WordPress site URL must be a non-empty string.')
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new UserError(`WordPress site URL is invalid: ${trimmed}`)
  }

  parsed.search = ''
  parsed.hash = ''
  return parsed.toString().replace(/\/$/, '')
}

function readHiddenString(
  extraArgs: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = extraArgs?.[key]
  if (value === undefined) {
    return undefined
  }

  if (typeof value !== 'string') {
    throw new UserError(`Hidden argument "${key}" must be a string when provided.`)
  }

  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw new UserError(`Hidden argument "${key}" must be a non-empty string when provided.`)
  }

  return trimmed
}

export function createAppConfigFromEnv(source: NodeJS.ProcessEnv): AppConfig {
  const parsedEnv = EnvSchema.parse(source)

  if (hasAnyLegacyMultiSiteEnv(source)) {
    throw new UserError(
      'Legacy multi-site WORDPRESS_N_* environment variables are no longer supported in this runtime. ' +
        'Use hidden per-call credentials in MissionSquad or configure single-site fallback with ' +
        'WORDPRESS_API_URL, WORDPRESS_USERNAME, and WORDPRESS_PASSWORD.'
    )
  }

  const fallbackSiteUrl = readOptionalEnvString(parsedEnv.WORDPRESS_API_URL)
  const fallbackUsername = readOptionalEnvString(parsedEnv.WORDPRESS_USERNAME)
  const fallbackPassword = readOptionalEnvString(parsedEnv.WORDPRESS_PASSWORD)
  const providedFallbackFieldCount = [fallbackSiteUrl, fallbackUsername, fallbackPassword].filter(Boolean).length

  if (providedFallbackFieldCount > 0 && providedFallbackFieldCount < 3) {
    throw new UserError(
      'Single-site env fallback must provide WORDPRESS_API_URL, WORDPRESS_USERNAME, and WORDPRESS_PASSWORD together.'
    )
  }

  return {
    fallbackSite:
      providedFallbackFieldCount === 3
        ? {
            siteUrl: normalizeSiteUrl(fallbackSiteUrl!),
            username: fallbackUsername!,
            password: fallbackPassword!,
          }
        : undefined,
    defaultSqlEndpoint: readOptionalEnvString(parsedEnv.WORDPRESS_SQL_ENDPOINT) ?? DEFAULT_SQL_ENDPOINT,
  }
}

export const appConfig: AppConfig = createAppConfigFromEnv(process.env)

export function resolveWordPressRequestConfig(
  extraArgs: Record<string, unknown> | undefined,
  defaults: AppConfig = appConfig,
): ResolvedWordPressRequestConfig {
  const siteUrl = readHiddenString(extraArgs, 'siteUrl') ?? defaults.fallbackSite?.siteUrl
  const username = readHiddenString(extraArgs, 'username') ?? defaults.fallbackSite?.username
  const password = readHiddenString(extraArgs, 'password') ?? defaults.fallbackSite?.password
  const sqlEndpoint = readHiddenString(extraArgs, 'sqlEndpoint') ?? defaults.defaultSqlEndpoint

  if (!siteUrl || !username || !password) {
    throw new UserError(
      'WordPress credentials are required. Provide hidden arguments "siteUrl", "username", and "password", ' +
        'or configure the single-site env fallback with WORDPRESS_API_URL, WORDPRESS_USERNAME, and WORDPRESS_PASSWORD.'
    )
  }

  return {
    site: {
      siteUrl: normalizeSiteUrl(siteUrl),
      username,
      password,
    },
    sqlEndpoint,
  }
}
