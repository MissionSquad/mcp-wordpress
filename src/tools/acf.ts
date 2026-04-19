import { type Tool } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import {
  describeRestRoute,
  makeRestRouteRequest,
  resolveContentRoute,
  resolveTaxonomyRoute,
  type RestRoute,
} from './rest-helpers.js'
import { makeWordPressRequest } from '../wordpress.js'

type ToolWithZodSchema = Tool & {
  zodSchema?: z.ZodTypeAny
}

export const getAcfSchemaSchema = z
  .object({
    target: z
      .preprocess((value) => {
        if (typeof value !== 'string') {
          return value
        }

        const normalized = value.trim().toLowerCase()
        const aliases: Record<string, string> = {
          post: 'content',
          posts: 'content',
          page: 'content',
          pages: 'content',
          cpt: 'content',
          custom_post_type: 'content',
          custom_post: 'content',
          taxonomy: 'term',
          terms: 'term',
          category: 'term',
          categories: 'term',
          tag: 'term',
          tags: 'term',
          users: 'user',
        }

        return aliases[normalized] ?? normalized
      }, z.enum(['content', 'term', 'user']))
      .default('content')
      .describe('Schema target. Use content for posts/pages/CPTs, term for taxonomy terms, and user for users.'),
    resource: z
      .preprocess((value) => (typeof value === 'string' && value.trim() === '' ? undefined : value), z.string().default('post'))
      .describe(
        'Actual WordPress resource to inspect. For content use post, page, steals, or category-page. For terms use category or post_tag. For users use me or a numeric user ID. Defaults to post.',
      ),
  })
  .passthrough()

type GetAcfSchemaParams =
  | { target: 'content'; content_type: string; id?: number }
  | { target: 'term'; taxonomy: string; id?: number }
  | { target: 'user'; id?: number | 'me' }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readPath(source: unknown, path: string[]): unknown {
  return path.reduce<unknown>((current, key) => {
    if (!isRecord(current)) {
      return undefined
    }

    return current[key]
  }, source)
}

function readOptionalNonEmptyString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key]
  if (typeof value !== 'string') {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function readOptionalId(source: Record<string, unknown>, key: string): number | 'me' | undefined {
  const value = source[key]

  if (value === undefined || value === null) {
    return undefined
  }

  if (typeof value === 'number' && Number.isInteger(value)) {
    return value
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.length === 0) {
      return undefined
    }
    if (trimmed === 'me') {
      return 'me'
    }
    if (/^\d+$/.test(trimmed)) {
      return Number(trimmed)
    }
  }

  throw new Error(`${key} must be a numeric ID or "me".`)
}

function findAcfSchemaDeep(source: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 8) {
    return null
  }

  if (Array.isArray(source)) {
    for (const item of source) {
      const found = findAcfSchemaDeep(item, depth + 1)
      if (found) {
        return found
      }
    }

    return null
  }

  if (!isRecord(source)) {
    return null
  }

  const acf = source.acf
  if (isRecord(acf) && Object.prototype.hasOwnProperty.call(acf, 'properties')) {
    return acf
  }

  for (const value of Object.values(source)) {
    const found = findAcfSchemaDeep(value, depth + 1)
    if (found) {
      return found
    }
  }

  return null
}

function extractAcfSchema(response: unknown): Record<string, unknown> | null {
  const candidates = [
    readPath(response, ['acf']),
    readPath(response, ['schema', 'properties', 'acf']),
    readPath(response, ['routes']),
  ]

  for (const candidate of candidates) {
    if (isRecord(candidate) && Object.prototype.hasOwnProperty.call(candidate, 'properties')) {
      return candidate
    }
  }

  if (isRecord(response)) {
    for (const routeDefinition of Object.values(response)) {
      const routeAcfSchema = readPath(routeDefinition, ['schema', 'properties', 'acf'])
      if (isRecord(routeAcfSchema) && Object.prototype.hasOwnProperty.call(routeAcfSchema, 'properties')) {
        return routeAcfSchema
      }
    }
  }

  const routes = readPath(response, ['routes'])
  if (isRecord(routes)) {
    for (const routeDefinition of Object.values(routes)) {
      const routeAcfSchema = readPath(routeDefinition, ['schema', 'properties', 'acf'])
      if (isRecord(routeAcfSchema) && Object.prototype.hasOwnProperty.call(routeAcfSchema, 'properties')) {
        return routeAcfSchema
      }
    }
  }

  return findAcfSchemaDeep(response)
}

async function requestOptionsForResolvedRoute(route: RestRoute, id?: number): Promise<unknown> {
  const suffix = id === undefined ? '' : `/${id}`
  return makeRestRouteRequest('OPTIONS', route, suffix)
}

function validateGetAcfSchemaParams(params: z.infer<typeof getAcfSchemaSchema>): GetAcfSchemaParams {
  const rawParams = params as Record<string, unknown>
  const resource = readOptionalNonEmptyString(rawParams, 'resource') ?? 'post'
  const id = readOptionalId(rawParams, 'id')

  if (params.target === 'content') {
    if (id === 'me') {
      throw new Error('id must be numeric when target is "content".')
    }

    return {
      target: 'content',
      content_type:
        readOptionalNonEmptyString(rawParams, 'content_type') ??
        readOptionalNonEmptyString(rawParams, 'contentType') ??
        resource,
      id,
    }
  }

  if (params.target === 'term') {
    if (id === 'me') {
      throw new Error('id must be numeric when target is "term".')
    }

    return {
      target: 'term',
      taxonomy: readOptionalNonEmptyString(rawParams, 'taxonomy') ?? resource,
      id,
    }
  }

  const userId =
    id ?? (resource !== 'post' && resource !== 'user' && resource !== 'users' ? readOptionalId({ resource }, 'resource') : undefined)

  return {
    target: 'user',
    id: userId,
  }
}

async function resolveAcfSchemaRequest(
  rawParams: z.infer<typeof getAcfSchemaSchema>,
): Promise<{ params: GetAcfSchemaParams; response: unknown; resolvedEndpoint: string }> {
  const params = validateGetAcfSchemaParams(rawParams)

  if (params.target === 'content') {
    const route = await resolveContentRoute(params.content_type)
    return {
      params,
      response: await requestOptionsForResolvedRoute(route, params.id),
      resolvedEndpoint: describeRestRoute({
        namespace: route.namespace,
        endpoint: params.id === undefined ? route.endpoint : `${route.endpoint}/${params.id}`,
      }),
    }
  }

  if (params.target === 'term') {
    const route = await resolveTaxonomyRoute(params.taxonomy)
    return {
      params,
      response: await requestOptionsForResolvedRoute(route, params.id),
      resolvedEndpoint: describeRestRoute({
        namespace: route.namespace,
        endpoint: params.id === undefined ? route.endpoint : `${route.endpoint}/${params.id}`,
      }),
    }
  }

  const endpoint = params.id === undefined ? 'users' : `users/${params.id}`
  return {
    params,
    response: await makeWordPressRequest('OPTIONS', endpoint),
    resolvedEndpoint: `wp/v2/${endpoint}`,
  }
}

export const acfTools: ToolWithZodSchema[] = [
  {
    name: 'get_acf_schema',
    description:
      'Discovers Advanced Custom Fields (ACF/ACF Pro) REST schema for content, terms, or users. Use target plus resource, for example {"target":"content","resource":"post"}, {"target":"content","resource":"page"}, {"target":"content","resource":"steals"}, {"target":"term","resource":"category"}, or {"target":"user","resource":"me"}. It returns only fields exposed by WordPress/ACF through REST; it does not infer database meta keys. When updating ACF fields, pass values under the nested "acf" object on the relevant create/update tool.',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          enum: ['content', 'term', 'user'],
          default: 'content',
          description:
            'Resource kind to inspect. Use content for posts/pages/CPTs, term for taxonomies, or user for users.',
        },
        resource: {
          type: 'string',
          default: 'post',
          description:
            'Actual WordPress resource to inspect. For content use post, page, steals, or category-page. For terms use category or post_tag. For users use me or a numeric user ID.',
        },
      },
      examples: [
        { target: 'content', resource: 'post' },
        { target: 'content', resource: 'page' },
        { target: 'content', resource: 'steals' },
        { target: 'term', resource: 'category' },
        { target: 'user', resource: 'me' },
      ],
      additionalProperties: true,
    },
    zodSchema: getAcfSchemaSchema,
  },
]

export const acfHandlers = {
  get_acf_schema: async (rawParams: z.infer<typeof getAcfSchemaSchema>) => {
    try {
      const { params, response, resolvedEndpoint } = await resolveAcfSchemaRequest(rawParams)
      const rawAcfSchema = extractAcfSchema(response)
      const rawAcfProperties = rawAcfSchema?.properties
      const acfSchema = isRecord(rawAcfProperties) ? rawAcfProperties : {}
      const acfAvailable = rawAcfSchema !== null

      return {
        toolResult: {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  target: params.target,
                  resolved_endpoint: resolvedEndpoint,
                  acf_available: acfAvailable,
                  acf_schema: acfSchema,
                  acf_properties: rawAcfProperties ?? null,
                  acf_schema_has_field_properties: Object.keys(acfSchema).length > 0,
                  raw_acf_schema: rawAcfSchema,
                  message: acfAvailable
                    ? Object.keys(acfSchema).length > 0
                      ? 'ACF fields are exposed in the REST schema. Use these field names under the nested "acf" object when creating or updating.'
                      : 'The REST schema exposes an ACF field data object, but it does not enumerate individual ACF field properties for this target. Reads may still include an acf key; writes require known field names from WordPress/ACF configuration.'
                    : 'No ACF schema was present in the REST OPTIONS response. ACF may be disabled, the field group may not have Show in REST API enabled, or no ACF field group applies to this target.',
                },
                null,
                2,
              ),
            },
          ],
          isError: false,
        },
      }
    } catch (error: any) {
      return {
        toolResult: {
          content: [
            {
              type: 'text' as const,
              text: `Error getting ACF schema: ${error.response?.data?.message || error.message}`,
            },
          ],
          isError: true,
        },
      }
    }
  },
}
