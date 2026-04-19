// src/tools/unified-taxonomies.ts
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { logToFile } from '../wordpress.js';
import { z } from 'zod';
import {
  buildReadQueryParams,
  getTaxonomies,
  makeRestRouteRequest,
  resolveContentRoute,
  resolveTaxonomyRoute,
} from './rest-helpers.js';

// Schema definitions
const restFieldsSchema = z
  .array(z.string())
  .optional()
  .describe('Optional WordPress REST _fields selector. Use ["acf"] to return only ACF term data, or entries like "acf.field_name", "id", and "name" for focused reads.');

const acfFormatSchema = z
  .enum(['light', 'standard'])
  .optional()
  .describe('Optional ACF REST output format. "light" is the ACF default raw/schema-aligned format; "standard" applies full ACF formatting.');

const acfPayloadSchema = z
  .record(z.unknown())
  .optional()
  .describe('Advanced Custom Fields (ACF/ACF Pro) values for this taxonomy term. Sent exactly as the nested WordPress REST "acf" object. Use get_acf_schema first when field names or value types are unknown.');

const discoverTaxonomiesSchema = z.object({
  content_type: z.string().optional().describe("Limit results to taxonomies associated with a specific content type"),
  refresh_cache: z.boolean().optional().describe("Force refresh the taxonomies cache")
});

const listTermsSchema = z.object({
  taxonomy: z.string().describe("The taxonomy slug (e.g., 'category', 'post_tag', or custom taxonomies)"),
  page: z.number().optional().describe("Page number (default 1)"),
  per_page: z.number().min(1).max(100).optional().describe("Items per page (default 10, max 100)"),
  search: z.string().optional().describe("Search term for term name"),
  parent: z.number().optional().describe("Parent term ID to retrieve direct children"),
  slug: z.string().optional().describe("Limit result to terms with a specific slug"),
  hide_empty: z.boolean().optional().describe("Whether to hide terms not assigned to any content"),
  orderby: z.enum(['id', 'include', 'name', 'slug', 'term_group', 'description', 'count']).optional().describe("Sort terms by parameter"),
  order: z.enum(['asc', 'desc']).optional().describe("Order sort attribute"),
  fields: restFieldsSchema,
  acf_format: acfFormatSchema
});

const getTermSchema = z.object({
  taxonomy: z.string().describe("The taxonomy slug"),
  id: z.number().describe("Term ID"),
  fields: restFieldsSchema,
  acf_format: acfFormatSchema
});

const createTermSchema = z.object({
  taxonomy: z.string().describe("The taxonomy slug"),
  name: z.string().describe("Term name"),
  slug: z.string().optional().describe("Term slug"),
  parent: z.number().optional().describe("Parent term ID"),
  description: z.string().optional().describe("Term description"),
  meta: z.record(z.any()).optional().describe("Term meta fields"),
  acf: acfPayloadSchema
});

const updateTermSchema = z.object({
  taxonomy: z.string().describe("The taxonomy slug"),
  id: z.number().describe("Term ID"),
  name: z.string().optional().describe("Term name"),
  slug: z.string().optional().describe("Term slug"),
  parent: z.number().optional().describe("Parent term ID"),
  description: z.string().optional().describe("Term description"),
  meta: z.record(z.any()).optional().describe("Term meta fields"),
  acf: acfPayloadSchema
});

const deleteTermSchema = z.object({
  taxonomy: z.string().describe("The taxonomy slug"),
  id: z.number().describe("Term ID"),
  force: z.boolean().optional().describe("Required to be true, as terms do not support trashing")
});

const assignTermsToContentSchema = z.object({
  content_id: z.number().describe("The content ID"),
  content_type: z.string().describe("The content type slug"),
  taxonomy: z.string().describe("The taxonomy slug"),
  terms: z.array(z.union([z.number(), z.string()])).describe("Array of term IDs or slugs to assign"),
  append: z.boolean().optional().describe("If true, append terms to existing ones. If false, replace all terms")
});

const getContentTermsSchema = z.object({
  content_id: z.number().describe("The content ID"),
  content_type: z.string().describe("The content type slug"),
  taxonomy: z.string().optional().describe("Specific taxonomy to retrieve terms from (if not specified, returns all)")
});

// Type definitions
type DiscoverTaxonomiesParams = z.infer<typeof discoverTaxonomiesSchema>;
type ListTermsParams = z.infer<typeof listTermsSchema>;
type GetTermParams = z.infer<typeof getTermSchema>;
type CreateTermParams = z.infer<typeof createTermSchema>;
type UpdateTermParams = z.infer<typeof updateTermSchema>;
type DeleteTermParams = z.infer<typeof deleteTermSchema>;
type AssignTermsToContentParams = z.infer<typeof assignTermsToContentSchema>;
type GetContentTermsParams = z.infer<typeof getContentTermsSchema>;

export const unifiedTaxonomyTools: Tool[] = [
  {
    name: "discover_taxonomies",
    description: "Discovers all available taxonomies (built-in and custom) in the WordPress site",
    inputSchema: { type: "object", properties: discoverTaxonomiesSchema.shape }
  },
  {
    name: "list_terms",
    description: "Lists terms in any taxonomy (categories, tags, or custom taxonomies) with filtering and pagination. ACF fields are returned when the site exposes them; use fields: [\"acf\"] and optional acf_format for focused ACF reads.",
    inputSchema: { type: "object", properties: listTermsSchema.shape }
  },
  {
    name: "get_term",
    description: "Gets a specific term by ID from any taxonomy. ACF fields are returned when the site exposes them; use fields: [\"acf\"] and optional acf_format for focused ACF reads.",
    inputSchema: { type: "object", properties: getTermSchema.shape }
  },
  {
    name: "create_term",
    description: "Creates a new term in any taxonomy. To set ACF/ACF Pro term fields, pass them under the nested acf object after verifying unknown fields with get_acf_schema.",
    inputSchema: { type: "object", properties: createTermSchema.shape }
  },
  {
    name: "update_term",
    description: "Updates an existing term in any taxonomy. To set ACF/ACF Pro term fields, pass them under the nested acf object after verifying unknown fields with get_acf_schema.",
    inputSchema: { type: "object", properties: updateTermSchema.shape }
  },
  {
    name: "delete_term",
    description: "Deletes a term from any taxonomy",
    inputSchema: { type: "object", properties: deleteTermSchema.shape }
  },
  {
    name: "assign_terms_to_content",
    description: "Assigns taxonomy terms to content of any type",
    inputSchema: { type: "object", properties: assignTermsToContentSchema.shape }
  },
  {
    name: "get_content_terms",
    description: "Gets all taxonomy terms assigned to content of any type",
    inputSchema: { type: "object", properties: getContentTermsSchema.shape }
  }
];

export const unifiedTaxonomyHandlers = {
  discover_taxonomies: async (params: DiscoverTaxonomiesParams) => {
    try {
      const taxonomies = await getTaxonomies(params.refresh_cache || false);
      
      // Filter by content type if specified
      let filteredTaxonomies = taxonomies;
      if (params.content_type) {
        filteredTaxonomies = Object.fromEntries(
          Object.entries(taxonomies).filter(([_, tax]: [string, any]) => 
            tax.types && tax.types.includes(params.content_type)
          )
        );
      }
      
      // Format the response to be more readable
      const formattedTaxonomies = Object.entries(filteredTaxonomies).map(([slug, tax]: [string, any]) => ({
        slug,
        name: tax.name,
        description: tax.description,
        types: tax.types,
        hierarchical: tax.hierarchical,
        rest_base: tax.rest_base,
        rest_namespace: tax.rest_namespace,
        labels: tax.labels
      }));
      
      return {
        toolResult: {
          content: [{ 
            type: 'text', 
            text: JSON.stringify(formattedTaxonomies, null, 2) 
          }],
          isError: false
        }
      };
    } catch (error: any) {
      return {
        toolResult: {
          content: [{ 
            type: 'text', 
            text: `Error discovering taxonomies: ${error.message}` 
          }],
          isError: true
        }
      };
    }
  },

  list_terms: async (params: ListTermsParams) => {
    try {
      const route = await resolveTaxonomyRoute(params.taxonomy);
      const { taxonomy, fields, acf_format, ...queryParams } = params;
      
      const response = await makeRestRouteRequest('GET', route, '', {
        ...queryParams,
        ...buildReadQueryParams({ fields, acf_format })
      });
      
      return {
        toolResult: {
          content: [{ 
            type: 'text', 
            text: JSON.stringify(response, null, 2) 
          }],
          isError: false
        }
      };
    } catch (error: any) {
      return {
        toolResult: {
          content: [{ 
            type: 'text', 
            text: `Error listing terms: ${error.message}` 
          }],
          isError: true
        }
      };
    }
  },

  get_term: async (params: GetTermParams) => {
    try {
      const route = await resolveTaxonomyRoute(params.taxonomy);
      
      const response = await makeRestRouteRequest(
        'GET',
        route,
        `/${params.id}`,
        buildReadQueryParams({ fields: params.fields, acf_format: params.acf_format })
      );
      
      return {
        toolResult: {
          content: [{ 
            type: 'text', 
            text: JSON.stringify(response, null, 2) 
          }],
          isError: false
        }
      };
    } catch (error: any) {
      return {
        toolResult: {
          content: [{ 
            type: 'text', 
            text: `Error getting term: ${error.message}` 
          }],
          isError: true
        }
      };
    }
  },

  create_term: async (params: CreateTermParams) => {
    try {
      const route = await resolveTaxonomyRoute(params.taxonomy);
      
      const termData: any = {
        name: params.name
      };
      
      if (params.slug !== undefined) termData.slug = params.slug;
      if (params.parent !== undefined) termData.parent = params.parent;
      if (params.description !== undefined) termData.description = params.description;
      if (params.meta !== undefined) termData.meta = params.meta;
      if (params.acf !== undefined) termData.acf = params.acf;
      
      const response = await makeRestRouteRequest('POST', route, '', termData);
      
      return {
        toolResult: {
          content: [{ 
            type: 'text', 
            text: JSON.stringify(response, null, 2) 
          }],
          isError: false
        }
      };
    } catch (error: any) {
      return {
        toolResult: {
          content: [{ 
            type: 'text', 
            text: `Error creating term: ${error.message}` 
          }],
          isError: true
        }
      };
    }
  },

  update_term: async (params: UpdateTermParams) => {
    try {
      const route = await resolveTaxonomyRoute(params.taxonomy);
      
      const updateData: any = {};
      
      if (params.name !== undefined) updateData.name = params.name;
      if (params.slug !== undefined) updateData.slug = params.slug;
      if (params.parent !== undefined) updateData.parent = params.parent;
      if (params.description !== undefined) updateData.description = params.description;
      if (params.meta !== undefined) updateData.meta = params.meta;
      if (params.acf !== undefined) updateData.acf = params.acf;
      
      const response = await makeRestRouteRequest('POST', route, `/${params.id}`, updateData);
      
      return {
        toolResult: {
          content: [{ 
            type: 'text', 
            text: JSON.stringify(response, null, 2) 
          }],
          isError: false
        }
      };
    } catch (error: any) {
      return {
        toolResult: {
          content: [{ 
            type: 'text', 
            text: `Error updating term: ${error.message}` 
          }],
          isError: true
        }
      };
    }
  },

  delete_term: async (params: DeleteTermParams) => {
    try {
      const route = await resolveTaxonomyRoute(params.taxonomy);
      
      const response = await makeRestRouteRequest('DELETE', route, `/${params.id}`, {
        force: true // Terms require force to be true
      });
      
      return {
        toolResult: {
          content: [{ 
            type: 'text', 
            text: JSON.stringify(response, null, 2) 
          }],
          isError: false
        }
      };
    } catch (error: any) {
      return {
        toolResult: {
          content: [{ 
            type: 'text', 
            text: `Error deleting term: ${error.message}` 
          }],
          isError: true
        }
      };
    }
  },

  assign_terms_to_content: async (params: AssignTermsToContentParams) => {
    try {
      // Determine the content endpoint
      const contentRoute = await resolveContentRoute(params.content_type);
      
      // Prepare the update data
      const updateData: any = {};
      
      // The field name depends on the taxonomy
      if (params.taxonomy === 'category') {
        updateData.categories = params.terms;
      } else if (params.taxonomy === 'post_tag') {
        updateData.tags = params.terms;
      } else {
        // For custom taxonomies, use the taxonomy slug as the field name
        updateData[params.taxonomy] = params.terms;
      }
      
      // If appending, we need to get current terms first
      if (params.append) {
        try {
          const currentContent = await makeRestRouteRequest('GET', contentRoute, `/${params.content_id}`);
          const currentTerms = currentContent[params.taxonomy === 'category' ? 'categories' : 
                                              params.taxonomy === 'post_tag' ? 'tags' : 
                                              params.taxonomy] || [];
          
          // Merge current terms with new terms (remove duplicates)
          const allTerms = [...new Set([...currentTerms, ...params.terms])];
          updateData[params.taxonomy === 'category' ? 'categories' : 
                     params.taxonomy === 'post_tag' ? 'tags' : 
                     params.taxonomy] = allTerms;
        } catch (error) {
          // If we can't get current terms, just set the new ones
          logToFile(`Warning: Could not get current terms for append operation: ${error}`);
        }
      }
      
      const response = await makeRestRouteRequest('POST', contentRoute, `/${params.content_id}`, updateData);
      
      return {
        toolResult: {
          content: [{ 
            type: 'text', 
            text: JSON.stringify({
              success: true,
              content_id: params.content_id,
              content_type: params.content_type,
              taxonomy: params.taxonomy,
              assigned_terms: params.terms,
              appended: params.append || false,
              content: response
            }, null, 2) 
          }],
          isError: false
        }
      };
    } catch (error: any) {
      return {
        toolResult: {
          content: [{ 
            type: 'text', 
            text: `Error assigning terms to content: ${error.message}` 
          }],
          isError: true
        }
      };
    }
  },

  get_content_terms: async (params: GetContentTermsParams) => {
    try {
      // First, get the content to see what taxonomies are assigned
      const contentRoute = await resolveContentRoute(params.content_type);
      const content = await makeRestRouteRequest('GET', contentRoute, `/${params.content_id}`);
      
      // Get all available taxonomies
      const taxonomies = await getTaxonomies();
      
      const terms: any = {};
      
      // If specific taxonomy requested
      if (params.taxonomy) {
        const taxonomyField = params.taxonomy === 'category' ? 'categories' : 
                              params.taxonomy === 'post_tag' ? 'tags' : 
                              params.taxonomy;
        
        if (content[taxonomyField]) {
          // Get full term details
          const route = await resolveTaxonomyRoute(params.taxonomy);
          const termDetails = await Promise.all(
            content[taxonomyField].map(async (termId: number) => {
              try {
                return await makeRestRouteRequest('GET', route, `/${termId}`);
              } catch {
                return { id: termId, error: 'Could not fetch term details' };
              }
            })
          );
          terms[params.taxonomy] = termDetails;
        }
      } else {
        // Get all taxonomy terms for this content
        for (const [taxonomySlug, taxonomyInfo] of Object.entries(taxonomies)) {
          const tax = taxonomyInfo as any;
          // Check if this taxonomy applies to this content type
          if (tax.types && tax.types.includes(params.content_type)) {
            const taxonomyField = taxonomySlug === 'category' ? 'categories' : 
                                  taxonomySlug === 'post_tag' ? 'tags' : 
                                  taxonomySlug;
            
            if (content[taxonomyField] && Array.isArray(content[taxonomyField]) && content[taxonomyField].length > 0) {
              const route = await resolveTaxonomyRoute(taxonomySlug);
              const termDetails = await Promise.all(
                content[taxonomyField].map(async (termId: number) => {
                  try {
                    return await makeRestRouteRequest('GET', route, `/${termId}`);
                  } catch {
                    return { id: termId, error: 'Could not fetch term details' };
                  }
                })
              );
              terms[taxonomySlug] = termDetails;
            }
          }
        }
      }
      
      return {
        toolResult: {
          content: [{ 
            type: 'text', 
            text: JSON.stringify({
              content_id: params.content_id,
              content_type: params.content_type,
              terms: terms
            }, null, 2) 
          }],
          isError: false
        }
      };
    } catch (error: any) {
      return {
        toolResult: {
          content: [{ 
            type: 'text', 
            text: `Error getting content terms: ${error.message}` 
          }],
          isError: true
        }
      };
    }
  }
};
