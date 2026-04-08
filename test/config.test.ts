import { describe, expect, it } from 'vitest'
import {
  createAppConfigFromEnv,
  resolveWordPressRequestConfig,
  type AppConfig,
} from '../src/config.js'

const TEST_DEFAULTS: AppConfig = {
  fallbackSite: {
    siteUrl: 'https://example.com',
    username: 'fallback-user',
    password: 'fallback-password',
  },
  defaultSqlEndpoint: '/mcp/v1/query',
}

describe('createAppConfigFromEnv', () => {
  it('creates a single-site fallback when all required env vars are present', () => {
    const config = createAppConfigFromEnv({
      WORDPRESS_API_URL: 'https://example.com/',
      WORDPRESS_USERNAME: 'admin',
      WORDPRESS_PASSWORD: 'secret',
    })

    expect(config.fallbackSite).toEqual({
      siteUrl: 'https://example.com',
      username: 'admin',
      password: 'secret',
    })
  })

  it('rejects partial single-site env fallback', () => {
    expect(() =>
      createAppConfigFromEnv({
        WORDPRESS_API_URL: 'https://example.com',
        WORDPRESS_USERNAME: 'admin',
      }),
    ).toThrow('Single-site env fallback')
  })

  it('rejects legacy multi-site env vars', () => {
    expect(() =>
      createAppConfigFromEnv({
        WORDPRESS_1_URL: 'https://example.com',
        WORDPRESS_1_USERNAME: 'admin',
        WORDPRESS_1_PASSWORD: 'secret',
      }),
    ).toThrow('Legacy multi-site WORDPRESS_N_* environment variables')
  })
})

describe('resolveWordPressRequestConfig', () => {
  it('prefers hidden values over env fallback', () => {
    const resolved = resolveWordPressRequestConfig(
      {
        siteUrl: 'https://hidden.example.com/',
        username: 'hidden-user',
        password: 'hidden-password',
        sqlEndpoint: '/custom/sql',
      },
      TEST_DEFAULTS,
    )

    expect(resolved).toEqual({
      site: {
        siteUrl: 'https://hidden.example.com',
        username: 'hidden-user',
        password: 'hidden-password',
      },
      sqlEndpoint: '/custom/sql',
    })
  })

  it('uses env fallback when hidden values are absent', () => {
    const resolved = resolveWordPressRequestConfig(undefined, TEST_DEFAULTS)

    expect(resolved).toEqual({
      site: TEST_DEFAULTS.fallbackSite!,
      sqlEndpoint: '/mcp/v1/query',
    })
  })

  it('throws when no hidden values or env fallback are available', () => {
    expect(() =>
      resolveWordPressRequestConfig(undefined, {
        fallbackSite: undefined,
        defaultSqlEndpoint: '/mcp/v1/query',
      }),
    ).toThrow('WordPress credentials are required')
  })
})

