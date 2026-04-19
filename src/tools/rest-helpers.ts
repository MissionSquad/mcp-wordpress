import {
  getCurrentSiteCacheKey,
  logToFile,
  makeWordPressRequest,
  makeWordPressRestRequest,
  type RequestOptions,
} from '../wordpress.js'

export type RestRoute = {
  namespace: string
  endpoint: string
}

export type AcfFormat = 'light' | 'standard'

export type RestReadOptions = {
  fields?: string[]
  acf_format?: AcfFormat
}

const CACHE_DURATION = 5 * 60 * 1000
const postTypesCache = new Map<string, { value: Record<string, any>; timestamp: number }>()
const taxonomiesCache = new Map<string, { value: Record<string, any>; timestamp: number }>()

function normalizeNamespace(namespace: unknown): string {
  return typeof namespace === 'string' && namespace.trim().length > 0 ? namespace.trim() : 'wp/v2'
}

function normalizeEndpoint(endpoint: string): string {
  return endpoint.replace(/^\/+|\/+$/g, '')
}

function fallbackContentEndpoint(contentType: string): string {
  const endpointMap: Record<string, string> = {
    post: 'posts',
    page: 'pages',
  }

  return endpointMap[contentType] || contentType
}

function fallbackTaxonomyEndpoint(taxonomy: string): string {
  const endpointMap: Record<string, string> = {
    category: 'categories',
    post_tag: 'tags',
    nav_menu: 'menus',
    link_category: 'link_categories',
  }

  return endpointMap[taxonomy] || taxonomy
}

export function describeRestRoute(route: RestRoute): string {
  return `${normalizeNamespace(route.namespace)}/${normalizeEndpoint(route.endpoint)}`
}

export function buildReadQueryParams(
  options: RestReadOptions,
  requiredFields: string[] = [],
): Record<string, unknown> {
  const queryParams: Record<string, unknown> = {}
  const requestedFields = options.fields ?? []
  const mergedFields = [...new Set([...requestedFields, ...requiredFields])]

  if (mergedFields.length > 0) {
    queryParams._fields = mergedFields.join(',')
  }

  if (options.acf_format !== undefined) {
    queryParams.acf_format = options.acf_format
  }

  return queryParams
}

export async function getPostTypes(forceRefresh = false): Promise<Record<string, any>> {
  const now = Date.now()
  const cacheKey = getCurrentSiteCacheKey()
  const cached = postTypesCache.get(cacheKey)

  if (!forceRefresh && cached && now - cached.timestamp < CACHE_DURATION) {
    logToFile('Using cached post types')
    return cached.value
  }

  logToFile('Fetching post types from API')
  const response = await makeWordPressRequest('GET', 'types')
  postTypesCache.set(cacheKey, { value: response, timestamp: now })
  return response
}

export async function getTaxonomies(forceRefresh = false): Promise<Record<string, any>> {
  const now = Date.now()
  const cacheKey = getCurrentSiteCacheKey()
  const cached = taxonomiesCache.get(cacheKey)

  if (!forceRefresh && cached && now - cached.timestamp < CACHE_DURATION) {
    logToFile('Using cached taxonomies')
    return cached.value
  }

  logToFile('Fetching taxonomies from API')
  const response = await makeWordPressRequest('GET', 'taxonomies')
  taxonomiesCache.set(cacheKey, { value: response, timestamp: now })
  return response
}

export async function resolveContentRoute(contentType: string): Promise<RestRoute> {
  try {
    const postTypes = await getPostTypes()
    const postType = postTypes[contentType]

    if (postType && typeof postType === 'object') {
      return {
        namespace: normalizeNamespace(postType.rest_namespace),
        endpoint: normalizeEndpoint(
          typeof postType.rest_base === 'string' && postType.rest_base.length > 0
            ? postType.rest_base
            : fallbackContentEndpoint(contentType),
        ),
      }
    }
  } catch (error) {
    logToFile(`Warning: Could not resolve REST base for content type "${contentType}": ${String(error)}`)
  }

  return {
    namespace: 'wp/v2',
    endpoint: fallbackContentEndpoint(contentType),
  }
}

export async function resolveTaxonomyRoute(taxonomy: string): Promise<RestRoute> {
  try {
    const taxonomies = await getTaxonomies()
    const taxonomyDefinition = taxonomies[taxonomy]

    if (taxonomyDefinition && typeof taxonomyDefinition === 'object') {
      return {
        namespace: normalizeNamespace(taxonomyDefinition.rest_namespace),
        endpoint: normalizeEndpoint(
          typeof taxonomyDefinition.rest_base === 'string' && taxonomyDefinition.rest_base.length > 0
            ? taxonomyDefinition.rest_base
            : fallbackTaxonomyEndpoint(taxonomy),
        ),
      }
    }
  } catch (error) {
    logToFile(`Warning: Could not resolve REST base for taxonomy "${taxonomy}": ${String(error)}`)
  }

  return {
    namespace: 'wp/v2',
    endpoint: fallbackTaxonomyEndpoint(taxonomy),
  }
}

export async function makeRestRouteRequest(
  method: Parameters<typeof makeWordPressRequest>[0],
  route: RestRoute,
  endpointSuffix = '',
  data?: unknown,
  options?: RequestOptions,
): Promise<any> {
  const endpoint = normalizeEndpoint(`${route.endpoint}${endpointSuffix}`)

  if (normalizeNamespace(route.namespace) === 'wp/v2') {
    return makeWordPressRequest(method, endpoint, data, options)
  }

  return makeWordPressRestRequest(method, route.namespace, endpoint, data, options)
}
