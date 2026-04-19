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

const contentAcfSchemaTarget = z
  .object({
    target: z.literal('content').describe('Use for posts, pages, and custom post types.'),
    content_type: z
      .string()
      .describe('WordPress post type slug, such as post, page, book, product, or another custom post type slug.'),
    id: z
      .number()
      .optional()
      .describe('Optional content ID. Omit to inspect the collection schema for this post type.'),
  })
  .strict()

const termAcfSchemaTarget = z
  .object({
    target: z.literal('term').describe('Use for categories, tags, and custom taxonomy terms.'),
    taxonomy: z
      .string()
      .describe('WordPress taxonomy slug, such as category, post_tag, genre, or another custom taxonomy slug.'),
    id: z
      .number()
      .optional()
      .describe('Optional term ID. Omit to inspect the collection schema for this taxonomy.'),
  })
  .strict()

const userAcfSchemaTarget = z
  .object({
    target: z.literal('user').describe('Use for ACF field groups attached to WordPress users.'),
    id: z
      .union([z.number(), z.literal('me')])
      .optional()
      .describe('Optional user ID, or "me" for the authenticated user. Omit to inspect the users collection schema.'),
  })
  .strict()

const getAcfSchemaSchema = z.discriminatedUnion('target', [
  contentAcfSchemaTarget,
  termAcfSchemaTarget,
  userAcfSchemaTarget,
])

type GetAcfSchemaParams = z.infer<typeof getAcfSchemaSchema>

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
  if (isRecord(acf) && isRecord(acf.properties)) {
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
    if (isRecord(candidate) && isRecord(candidate.properties)) {
      return candidate
    }
  }

  if (isRecord(response)) {
    for (const routeDefinition of Object.values(response)) {
      const routeAcfSchema = readPath(routeDefinition, ['schema', 'properties', 'acf'])
      if (isRecord(routeAcfSchema) && isRecord(routeAcfSchema.properties)) {
        return routeAcfSchema
      }
    }
  }

  const routes = readPath(response, ['routes'])
  if (isRecord(routes)) {
    for (const routeDefinition of Object.values(routes)) {
      const routeAcfSchema = readPath(routeDefinition, ['schema', 'properties', 'acf'])
      if (isRecord(routeAcfSchema) && isRecord(routeAcfSchema.properties)) {
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

async function resolveAcfSchemaRequest(
  params: GetAcfSchemaParams,
): Promise<{ response: unknown; resolvedEndpoint: string }> {
  if (params.target === 'content') {
    const route = await resolveContentRoute(params.content_type)
    return {
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
      response: await requestOptionsForResolvedRoute(route, params.id),
      resolvedEndpoint: describeRestRoute({
        namespace: route.namespace,
        endpoint: params.id === undefined ? route.endpoint : `${route.endpoint}/${params.id}`,
      }),
    }
  }

  const endpoint = params.id === undefined ? 'users' : `users/${params.id}`
  return {
    response: await makeWordPressRequest('OPTIONS', endpoint),
    resolvedEndpoint: `wp/v2/${endpoint}`,
  }
}

export const acfTools: ToolWithZodSchema[] = [
  {
    name: 'get_acf_schema',
    description:
      'Discovers Advanced Custom Fields (ACF/ACF Pro) REST schema for content, terms, or users. Use this before writing unknown ACF fields. It returns only fields exposed by WordPress/ACF through REST; it does not infer database meta keys. When updating ACF fields, pass values under the nested "acf" object on the relevant create/update tool.',
    inputSchema: {
      type: 'object',
      oneOf: [
        {
          type: 'object',
          properties: {
            target: { const: 'content', description: 'Posts, pages, and custom post types.' },
            content_type: {
              type: 'string',
              description: 'WordPress post type slug, such as post, page, book, or product.',
            },
            id: {
              type: 'number',
              description: 'Optional content ID. Omit to inspect the collection schema.',
            },
          },
          required: ['target', 'content_type'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: {
            target: { const: 'term', description: 'Categories, tags, and custom taxonomy terms.' },
            taxonomy: {
              type: 'string',
              description: 'WordPress taxonomy slug, such as category, post_tag, or genre.',
            },
            id: {
              type: 'number',
              description: 'Optional term ID. Omit to inspect the collection schema.',
            },
          },
          required: ['target', 'taxonomy'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: {
            target: { const: 'user', description: 'WordPress users.' },
            id: {
              anyOf: [{ type: 'number' }, { const: 'me' }],
              description: 'Optional user ID, or "me" for the authenticated user.',
            },
          },
          required: ['target'],
          additionalProperties: false,
        },
      ],
    },
    zodSchema: getAcfSchemaSchema,
  },
]

export const acfHandlers = {
  get_acf_schema: async (params: GetAcfSchemaParams) => {
    try {
      const { response, resolvedEndpoint } = await resolveAcfSchemaRequest(params)
      const rawAcfSchema = extractAcfSchema(response)
      const acfSchema = isRecord(rawAcfSchema?.properties) ? rawAcfSchema.properties : {}
      const acfAvailable = Object.keys(acfSchema).length > 0

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
                  raw_acf_schema: rawAcfSchema,
                  message: acfAvailable
                    ? 'ACF fields are exposed in the REST schema. Use these field names under the nested "acf" object when creating or updating.'
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
