// src/tools/users.ts
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { makeWordPressRequest } from '../wordpress.js';
import { WPUser } from '../types/wordpress-types.js';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { buildReadQueryParams } from './rest-helpers.js';

const restFieldsSchema = z
  .array(z.string())
  .optional()
  .describe('Optional WordPress REST _fields selector. Use ["acf"] to return only ACF user data, or entries like "acf.field_name", "id", and "name" for focused reads.');

const acfFormatSchema = z
  .enum(['light', 'standard'])
  .optional()
  .describe('Optional ACF REST output format. "light" is the ACF default raw/schema-aligned format; "standard" applies full ACF formatting.');

const acfPayloadSchema = z
  .record(z.unknown())
  .optional()
  .describe('Advanced Custom Fields (ACF/ACF Pro) values for this user. Sent exactly as the nested WordPress REST "acf" object. Use get_acf_schema first when field names or value types are unknown.');

const listUsersSchema = z.object({
  page: z.number().optional().describe("Page number (default 1)"),
  per_page: z.number().min(1).max(100).optional().describe("Items per page (default 10, max 100)"),
  search: z.string().optional().describe("Search term for user content or name"),
  context: z.enum(['view', 'embed', 'edit']).optional().describe("Scope under which the request is made"),
  orderby: z.enum(['id', 'include', 'name', 'registered_date', 'slug', 'email', 'url']).optional().describe("Sort users by parameter"),
  order: z.enum(['asc', 'desc']).optional().describe("Order sort attribute ascending or descending"),
  roles: z.array(z.string()).optional().describe("Array of role names to filter by"),
  fields: restFieldsSchema,
  acf_format: acfFormatSchema
});

const getUserSchema = z.object({
  id: z.number().describe("User ID"),
  context: z.enum(['view', 'embed', 'edit']).optional().describe("Scope under which the request is made"),
  fields: restFieldsSchema,
  acf_format: acfFormatSchema
}).strict();

const createUserSchema = z.object({
  username: z.string().describe("User login name"),
  name: z.string().optional().describe("Display name for the user"),
  first_name: z.string().optional().describe("First name for the user"),
  last_name: z.string().optional().describe("Last name for the user"),
  email: z.string().email().describe("Email address for the user"),
  url: z.string().url().optional().describe("URL of the user"),
  description: z.string().optional().describe("Description of the user"),
  locale: z.string().optional().describe("Locale for the user"),
  nickname: z.string().optional().describe("Nickname for the user"),
  slug: z.string().optional().describe("Slug for the user"),
  roles: z.array(z.string()).optional().describe("Roles assigned to the user"),
  password: z.string().describe("Password for the user"),
  acf: acfPayloadSchema
}).strict();

const updateUserSchema = z.object({
  id: z.number().describe("User ID"),
  username: z.string().optional().describe("User login name"),
  name: z.string().optional().describe("Display name for the user"),
  first_name: z.string().optional().describe("First name for the user"),
  last_name: z.string().optional().describe("Last name for the user"),
  email: z.string().email().optional().describe("Email address for the user"),
  url: z.string().url().optional().describe("URL of the user"),
  description: z.string().optional().describe("Description of the user"),
  locale: z.string().optional().describe("Locale for the user"),
  nickname: z.string().optional().describe("Nickname for the user"),
  slug: z.string().optional().describe("Slug for the user"),
  roles: z.array(z.string()).optional().describe("Roles assigned to the user"),
  password: z.string().optional().describe("Password for the user"),
  acf: acfPayloadSchema
}).strict();

const deleteUserSchema = z.object({
  id: z.number().describe("User ID"),
  force: z.boolean().optional().describe("Whether to bypass trash and force deletion"),
  reassign: z.number().optional().describe("User ID to reassign posts to")
}).strict();

type ListUsersParams = z.infer<typeof listUsersSchema>;
type GetUserParams = z.infer<typeof getUserSchema>;
type CreateUserParams = z.infer<typeof createUserSchema>;
type UpdateUserParams = z.infer<typeof updateUserSchema>;
type DeleteUserParams = z.infer<typeof deleteUserSchema>;

export const userTools: Tool[] = [
  {
    name: "list_users",
    description: "Lists all users with filtering, sorting, and pagination options. ACF user fields are returned when the site exposes them; use fields: [\"acf\"] and optional acf_format for focused ACF reads.",
    inputSchema: { type: "object", properties: listUsersSchema.shape }
  },
  {
    name: "get_user",
    description: "Gets a user by ID. ACF user fields are returned when the site exposes them; use fields: [\"acf\"] and optional acf_format for focused ACF reads.",
    inputSchema: { type: "object", properties: getUserSchema.shape }
  },
  {
    name: "create_user",
    description: "Creates a new user. To set ACF/ACF Pro user fields, pass them under the nested acf object after verifying unknown fields with get_acf_schema.",
    inputSchema: { type: "object", properties: createUserSchema.shape }
  },
  {
    name: "update_user",
    description: "Updates an existing user. To set ACF/ACF Pro user fields, pass them under the nested acf object after verifying unknown fields with get_acf_schema.",
    inputSchema: { type: "object", properties: updateUserSchema.shape }
  },
  {
    name: "delete_user",
    description: "Deletes a user",
    inputSchema: { type: "object", properties: deleteUserSchema.shape }
  }
];

export const userHandlers = {
  list_users: async (params: ListUsersParams) => {
    try {
      const { fields, acf_format, ...queryParams } = params;
      const response = await makeWordPressRequest('GET', "users", {
        ...queryParams,
        ...buildReadQueryParams({ fields, acf_format })
      });
      const users: WPUser[] = response;
      return {
        toolResult: {
          content: [{ type: 'text', text: JSON.stringify(users, null, 2) }],
        },
      };
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || error.message;
      return {
        toolResult: {
          isError: true,
          content: [{ type: 'text', text: `Error listing users: ${errorMessage}` }],
        },
      };
    }
  },
  get_user: async (params: GetUserParams) => {
    try {
      const response = await makeWordPressRequest('GET', `users/${params.id}`, {
        context: params.context,
        ...buildReadQueryParams({ fields: params.fields, acf_format: params.acf_format })
      });
      const user: WPUser = response;
      return {
        toolResult: {
          content: [{ type: 'text', text: JSON.stringify(user, null, 2) }],
        },
      };
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || error.message;
      return {
        toolResult: {
          isError: true,
          content: [{ type: 'text', text: `Error getting user: ${errorMessage}` }],
        },
      };
    }
  },
  create_user: async (params: CreateUserParams) => {
    try {
      const response = await makeWordPressRequest('POST', "users", params);
      const user: WPUser = response;
      return {
        toolResult: {
          content: [{ type: 'text', text: JSON.stringify(user, null, 2) }],
        },
      };
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || error.message;
      return {
        toolResult: {
          isError: true,
          content: [{ type: 'text', text: `Error creating user: ${errorMessage}` }],
        },
      };
    }
  },
  update_user: async (params: UpdateUserParams) => {
    try {
      const { id, ...updateData } = params;
      const response = await makeWordPressRequest('POST', `users/${id}`, updateData);
      const user: WPUser = response;
      return {
        toolResult: {
          content: [{ type: 'text', text: JSON.stringify(user, null, 2) }],
        },
      };
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || error.message;
      return {
        toolResult: {
          isError: true,
          content: [{ type: 'text', text: `Error updating user: ${errorMessage}` }],
        },
      };
    }
  },
  delete_user: async (params: DeleteUserParams) => {
    try {
      const response = await makeWordPressRequest('DELETE', `users/${params.id}`, { 
        force: params.force,
        reassign: params.reassign
      });
      const user: WPUser = response;
      return {
        toolResult: {
          content: [{ type: 'text', text: JSON.stringify(user, null, 2) }],
        },
      };
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || error.message;
      return {
        toolResult: {
          isError: true,
          content: [{ type: 'text', text: `Error deleting user: ${errorMessage}` }],
        },
      };
    }
  }
};
