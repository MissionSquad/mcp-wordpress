import { z } from 'zod'
import { type Tool } from '@modelcontextprotocol/sdk/types.js'
import { getCurrentSiteSummary, testCurrentSiteConnection } from '../wordpress.js'

const emptySchema = z.object({})

export const siteManagementTools: Tool[] = [
  {
    name: 'list_sites',
    description: 'List the current WordPress site configuration available for this tool call.',
    inputSchema: {
      type: 'object',
      properties: emptySchema.shape,
      required: [],
    },
  },
  {
    name: 'get_site',
    description: 'Get details about the current WordPress site configuration for this tool call.',
    inputSchema: {
      type: 'object',
      properties: emptySchema.shape,
      required: [],
    },
  },
  {
    name: 'test_site',
    description: 'Test the connection to the current WordPress site for this tool call.',
    inputSchema: {
      type: 'object',
      properties: emptySchema.shape,
      required: [],
    },
  },
]

export const siteManagementHandlers = {
  list_sites: async (_params: z.infer<typeof emptySchema>) => {
    try {
      const site = getCurrentSiteSummary()
      return {
        toolResult: {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  sites: [
                    {
                      id: site.id,
                      url: site.url,
                      isDefault: true,
                    },
                  ],
                  count: 1,
                  default_site: site.id,
                },
                null,
                2,
              ),
            },
          ],
        },
      }
    } catch (error: any) {
      return {
        toolResult: {
          content: [
            {
              type: 'text' as const,
              text: `Error listing sites: ${error.message}`,
            },
          ],
          isError: true,
        },
      }
    }
  },

  get_site: async (_params: z.infer<typeof emptySchema>) => {
    try {
      const site = getCurrentSiteSummary()
      return {
        toolResult: {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  id: site.id,
                  url: site.url,
                  isDefault: true,
                },
                null,
                2,
              ),
            },
          ],
        },
      }
    } catch (error: any) {
      return {
        toolResult: {
          content: [
            {
              type: 'text' as const,
              text: `Error getting site: ${error.message}`,
            },
          ],
          isError: true,
        },
      }
    }
  },

  test_site: async (_params: z.infer<typeof emptySchema>) => {
    try {
      const site = getCurrentSiteSummary()
      const result = await testCurrentSiteConnection()
      return {
        toolResult: {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  site_id: site.id,
                  site_url: site.url,
                  success: result.success,
                  error: result.error ?? null,
                  message: result.success
                    ? `Successfully connected to ${site.url}`
                    : `Failed to connect to ${site.url}: ${result.error}`,
                },
                null,
                2,
              ),
            },
          ],
          isError: !result.success,
        },
      }
    } catch (error: any) {
      return {
        toolResult: {
          content: [
            {
              type: 'text' as const,
              text: `Error testing site: ${error.message}`,
            },
          ],
          isError: true,
        },
      }
    }
  },
}
