# WordPress MCP Server

`@missionsquad/mcp-wp` is a stdio MCP server for interacting with WordPress through the WordPress REST API.

This package now supports two runtime modes:

- MissionSquad hidden-secret mode: per-call hidden credentials injected by MissionSquad
- local standalone mode: single-site env fallback

## Runtime Contract

### MissionSquad Hidden-Secret Mode

MissionSquad should register this server with hidden `secretNames` and inject them per tool call.

Recommended hidden keys:

- `siteUrl`
- `username`
- `password`
- `sqlEndpoint` (optional)

These values are intentionally not part of the public tool schema.

The server reads them from FastMCP `context.extraArgs`.

### Local Standalone Mode

For local usage outside MissionSquad, configure a single site with:

```env
WORDPRESS_API_URL=https://your-wordpress-site.com
WORDPRESS_USERNAME=wp_username
WORDPRESS_PASSWORD=wp_app_password
WORDPRESS_SQL_ENDPOINT=/mcp/v1/query
```

Only one fallback site is supported in env mode.

Legacy numbered `WORDPRESS_N_*` multi-site env configuration is no longer supported by this runtime.

## Features

- FastMCP stdio server
- hidden per-call WordPress credentials for MissionSquad compatibility
- single-site env fallback for local usage
- unified content tools
- unified taxonomy tools
- media, users, comments, plugins, and plugin-repository tools
- optional SQL query tool with custom endpoint

## Tool Surface

### Site

- `list_sites`
- `get_site`
- `test_site`

These now describe the current request-scoped site only.

### Content

- `list_content`
- `get_content`
- `create_content`
- `update_content`
- `delete_content`
- `discover_content_types`
- `find_content_by_url`
- `get_content_by_slug`

### Taxonomies

- `discover_taxonomies`
- `list_terms`
- `get_term`
- `create_term`
- `update_term`
- `delete_term`
- `assign_terms_to_content`
- `get_content_terms`

### Media

- `list_media`
- `create_media`
- `edit_media`
- `delete_media`

### Users

- `list_users`
- `get_user`
- `create_user`
- `update_user`
- `delete_user`

### Comments

- `list_comments`
- `get_comment`
- `create_comment`
- `update_comment`
- `delete_comment`

### Plugins

- `list_plugins`
- `get_plugin`
- `activate_plugin`
- `deactivate_plugin`
- `create_plugin`

### Plugin Repository

- `search_plugins`
- `get_plugin_info`

### SQL

- `execute_sql_query`

## MissionSquad Registration Example

```json
{
  "name": "mcp-wordpress",
  "transportType": "stdio",
  "command": "node",
  "args": ["/absolute/path/to/build/server.js"],
  "secretNames": ["siteUrl", "username", "password", "sqlEndpoint"],
  "enabled": true
}
```

## Local Development

### Install

```bash
npm install
```

### Build

```bash
npm run build
```

### Test

```bash
npm test
```

## GitHub Actions

This package includes MissionSquad-standard GitHub workflows:

- PR build/test on pull request `opened` and `synchronize`
- npm publish on push to `main`

The publish workflow targets the `@missionsquad` npm scope and publishes with:

```bash
npm publish --access public
```

### Run

```bash
npm start
```

### Dev Mode

```bash
npm run dev
```

## SQL Query Tool

`execute_sql_query` is intended for a custom read-only SQL endpoint on the target WordPress site.

Default endpoint:

```text
/mcp/v1/query
```

Override order:

1. hidden `sqlEndpoint`
2. `WORDPRESS_SQL_ENDPOINT`
3. default `/mcp/v1/query`

Only read-only queries are allowed.

## Security

- do not expose `siteUrl`, `username`, `password`, or `sqlEndpoint` in public tool schemas
- do not log hidden runtime config
- use HTTPS for WordPress sites
- use WordPress application passwords instead of primary login credentials
