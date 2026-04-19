import axios, { type AxiosInstance, type AxiosResponse } from 'axios'
import { getCurrentRequestClient, getCurrentRequestConfig, setCurrentRequestClient } from './request-context.js'

type HttpMethod = 'GET' | 'POST' | 'DELETE' | 'PUT' | 'OPTIONS'

export interface RequestOptions {
  headers?: Record<string, string>
  isFormData?: boolean
  rawResponse?: boolean
}

function buildBaseUrl(siteUrl: string): string {
  const normalized = siteUrl.endsWith('/') ? siteUrl : `${siteUrl}/`

  if (!normalized.includes('/wp-json/wp/v2/')) {
    if (normalized.includes('/wp-json/wp/v2')) {
      return `${normalized}/`
    }
    return `${normalized}wp-json/wp/v2/`
  }

  return normalized.endsWith('/') ? normalized : `${normalized}/`
}

function buildRestUrl(siteUrl: string, namespace: string, endpoint: string): string {
  const normalizedSiteUrl = siteUrl.endsWith('/') ? siteUrl.slice(0, -1) : siteUrl
  const wpJsonIndex = normalizedSiteUrl.indexOf('/wp-json')
  const siteRoot = wpJsonIndex >= 0 ? normalizedSiteUrl.slice(0, wpJsonIndex) : normalizedSiteUrl
  const cleanNamespace = namespace.replace(/^\/+|\/+$/g, '')
  const cleanEndpoint = endpoint.replace(/^\/+/, '')

  return `${siteRoot}/wp-json/${cleanNamespace}/${cleanEndpoint}`
}

function createWordPressClient(): AxiosInstance {
  const {
    site: { siteUrl, username, password },
  } = getCurrentRequestConfig()
  const auth = Buffer.from(`${username}:${password}`).toString('base64')

  return axios.create({
    baseURL: buildBaseUrl(siteUrl),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${auth}`,
    },
  })
}

function getWordPressClient(): AxiosInstance {
  const existing = getCurrentRequestClient()
  if (existing) {
    return existing
  }

  const client = createWordPressClient()
  setCurrentRequestClient(client)
  return client
}

export async function initWordPress(): Promise<void> {
  // No startup connection is required. MissionSquad hidden secrets are resolved per tool call.
}

export function logToFile(_message: string): void {
  // Logging disabled
}

export function getCurrentSiteSummary(): { id: 'current'; url: string; sqlEndpoint: string } {
  const { site, sqlEndpoint } = getCurrentRequestConfig()
  return {
    id: 'current',
    url: site.siteUrl,
    sqlEndpoint,
  }
}

export function getCurrentSiteCacheKey(): string {
  return getCurrentRequestConfig().site.siteUrl
}

export function getCurrentSqlEndpoint(): string {
  return getCurrentRequestConfig().sqlEndpoint
}

export async function testCurrentSiteConnection(): Promise<{ success: boolean; error?: string }> {
  try {
    const client = getWordPressClient()
    await client.get('users/me')
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function makeWordPressRequest(
  method: HttpMethod,
  endpoint: string,
  data?: unknown,
  options?: RequestOptions,
): Promise<any> {
  const client = getWordPressClient()
  const path = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint
  return makeRequest(client, method, path, data, options)
}

export async function makeWordPressRestRequest(
  method: HttpMethod,
  namespace: string,
  endpoint: string,
  data?: unknown,
  options?: RequestOptions,
): Promise<any> {
  const client = getWordPressClient()
  const {
    site: { siteUrl },
  } = getCurrentRequestConfig()
  return makeRequest(client, method, buildRestUrl(siteUrl, namespace, endpoint), data, options)
}

async function makeRequest(
  client: AxiosInstance,
  method: HttpMethod,
  path: string,
  data?: unknown,
  options?: RequestOptions,
): Promise<any> {
  const requestConfig: {
    method: HttpMethod
    url: string
    headers: Record<string, string>
    params?: unknown
    data?: unknown
  } = {
    method,
    url: path,
    headers: options?.headers ?? {},
  }

  if (method === 'GET') {
    requestConfig.params = data
  } else if (options?.isFormData) {
    requestConfig.data = data
  } else if (method === 'POST') {
    requestConfig.data = JSON.stringify(data)
  } else {
    requestConfig.data = data
  }

  const response = await client.request(requestConfig)
  return options?.rawResponse ? response : response.data
}

export async function searchWordPressPluginRepository(
  searchQuery: string,
  page = 1,
  perPage = 10,
): Promise<any> {
  const response = await axios.post(
    'https://api.wordpress.org/plugins/info/1.2/',
    {
      action: 'query_plugins',
      request: {
        search: searchQuery,
        page,
        per_page: perPage,
        fields: {
          description: true,
          sections: false,
          tested: true,
          requires: true,
          rating: true,
          ratings: false,
          downloaded: true,
          downloadlink: true,
          last_updated: true,
          homepage: true,
          tags: true,
        },
      },
    },
    {
      headers: {
        'Content-Type': 'application/json',
      },
    },
  )

  return response.data
}
