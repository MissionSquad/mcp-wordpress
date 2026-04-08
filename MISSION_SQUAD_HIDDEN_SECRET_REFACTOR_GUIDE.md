# mcp-wordpress MissionSquad Hidden Secret Refactor Guide

**Version:** 1.0  
**Date:** 2026-04-08  
**Status:** Implementation-Ready

## 1. Purpose

This guide defines the recommended refactor for making `mcp-wordpress` compatible with MissionSquad hidden secret injection.

It is package-specific and implementation-oriented. It is based on a verified review of the current `mcp-wordpress` codebase and is intended to be sufficient on its own for an engineer to perform the refactor.

## 2. Executive Summary

`mcp-wordpress` is not currently MissionSquad hidden-secret compatible.

The main reason is architectural:

- it uses the low-level MCP SDK server helper instead of `@missionsquad/fastmcp`
- its handlers only receive public tool args
- it resolves WordPress credentials from process environment only
- it initializes and tests the WordPress connection at server startup, before any per-user hidden values could exist
- it keeps authenticated clients in a global singleton keyed to env-defined sites

MissionSquad compatibility requires a different model:

1. The server must declare hidden keys in MissionSquad `secretNames`.
2. MissionSquad must inject those values per user per tool call.
3. The server must read those values from FastMCP `context.extraArgs`.
4. Client creation must become request-scoped and lazy.

## 3. Verified Current State

## 3.1 Package Runtime

The package currently:

- is TypeScript
- builds to `build/`
- runs a stdio MCP server
- uses `@modelcontextprotocol/sdk` directly
- targets Node `>=18`

## 3.2 Authentication Model

Current WordPress authentication is environment-driven only.

Single-site env mode:

- `WORDPRESS_API_URL`
- `WORDPRESS_USERNAME`
- `WORDPRESS_PASSWORD`

Multi-site env mode:

- `WORDPRESS_1_URL`
- `WORDPRESS_1_USERNAME`
- `WORDPRESS_1_PASSWORD`
- `WORDPRESS_1_ID`
- `WORDPRESS_1_DEFAULT`
- `WORDPRESS_1_ALIASES`
- repeated up to `WORDPRESS_10_*`

The authenticated Axios client is created with a Basic Auth header using:

```text
base64(username:password)
```

## 3.3 Server Runtime Pattern

`src/server.ts`:

- loads `.env`
- creates the MCP server
- registers tools
- calls `initWordPress()` during startup
- fails startup if a WordPress connection cannot be established immediately

This is incompatible with MissionSquad hidden injection because MissionSquad stdio servers start once and serve many users. Per-user secrets are only available at tool-call time, not process start.

## 3.4 Global Site Manager Pattern

`src/config/site-manager.ts` currently:

- lazily loads sites from environment variables
- stores site configs in a global singleton
- caches Axios clients by site id
- chooses a default site

This is incompatible with MissionSquad’s per-user hidden secret model because:

- config is process-global, not per user
- authenticated clients are cached globally
- the server has no request-scoped config source

## 3.5 Tool Surface Findings

### Good news

- public tool schemas do not currently expose the server’s own WordPress auth fields
- there is no current visible-schema collision with the future hidden keys if new names are chosen carefully

### Important constraints

- many public schemas already use generic names like `url`, `username`, and `password`
- therefore the hidden MissionSquad keys must **not** use those generic names

Examples of collisions to avoid:

- `username` would collide with `create_user`
- `password` would collide with `create_user` and `update_user`
- `url` would collide with `find_content_by_url` and user fields

### Site-management leakage

`src/tools/site-management.ts` currently returns:

- site URLs
- WordPress usernames
- aliases

That is not an acceptable default pattern for a MissionSquad hidden-secret server, because the package would be exposing hidden runtime configuration back to the LLM.

### Multi-site inconsistency

The README claims broad multi-site support, but the implementation is partial:

- `site_id` appears in `site-management.ts` and `unified-content.ts`
- most other tool modules do not accept `site_id`

This means the current multi-site story is incomplete even before any MissionSquad refactor.

### Multi-site cache bug

`src/tools/unified-content.ts` caches discovered content types globally, not per site.

That means content type discovery for one site can be reused incorrectly for another site.

## 3.6 Other Verified Hygiene Issues

These are not the main hidden-secret blockers, but they should be cleaned up during or immediately after the refactor:

- `src/cli.ts` checks `WORDPRESS_APP_PASSWORD`, while the rest of the package uses `WORDPRESS_PASSWORD`
- `src/tools/media.ts` dynamically imports `form-data`, but `form-data` is not declared in `package.json`
- `fs-extra` and several `zodToJsonSchema` imports appear unused

## 4. Recommended Product Decision

## 4.1 Phase 1 Scope: Single Site Per User

For MissionSquad compatibility, the recommended refactor scope is:

- one WordPress site per MissionSquad user per installed server
- hidden secrets provide the site URL and credentials for that one site
- local env fallback remains supported for standalone development

This is the recommended v1 because it is:

- compatible with MissionSquad’s flat string secret model
- compatible with per-user server installs
- much simpler than preserving env-indexed multi-site secrets
- safer than exposing site inventories to the model

## 4.2 Explicit Non-Goal For Phase 1

Do not preserve the current env-driven multi-site feature as part of the first MissionSquad hidden-secret refactor.

Reasons:

- the current multi-site support is incomplete across the tool surface
- site-management tools expose runtime config that should remain hidden
- the current cache strategy is not site-safe
- MissionSquad hidden-secret storage is a flat name/value model, not a first-class multi-site config store

## 4.3 Phase 2 Option

If product later requires multi-site hidden support, implement it as a separate phase after single-site hidden mode is stable.

A future multi-site phase should use a deliberately designed hidden config contract, not the current numbered env-variable model.

## 5. Target Hidden Secret Contract

Use the following hidden key names for MissionSquad registration:

- `wordpressUrl`
- `wordpressUsername`
- `wordpressPassword`
- `wordpressSqlEndpoint` (optional, only if the SQL tool is surfaced)

These names are recommended because they do not collide with current public tool schema fields.

Do **not** use:

- `url`
- `username`
- `password`

Those names already exist as public business inputs in the current tool surface.

## 5.1 MissionSquad `secretNames`

Recommended MissionSquad stdio server definition:

```json
{
  "name": "mcp-wordpress",
  "transportType": "stdio",
  "command": "node",
  "args": ["/absolute/path/to/build/server.js"],
  "secretNames": [
    "wordpressUrl",
    "wordpressUsername",
    "wordpressPassword",
    "wordpressSqlEndpoint"
  ],
  "enabled": true
}
```

If the SQL tool remains unregistered, omit `wordpressSqlEndpoint`.

## 5.2 Env Fallback Mapping

For standalone local use, keep these env fallbacks:

- `WORDPRESS_API_URL` -> `wordpressUrl`
- `WORDPRESS_USERNAME` -> `wordpressUsername`
- `WORDPRESS_PASSWORD` -> `wordpressPassword`
- `WORDPRESS_SQL_ENDPOINT` -> `wordpressSqlEndpoint`

Do not keep numbered multi-site env variables in the MissionSquad refactor scope.

## 6. Required Architecture Changes

## 6.1 Replace Raw SDK Server Wiring With FastMCP

Current package pattern:

- raw `McpServer`
- manual tool registration
- handlers that receive only `args`

Target pattern:

- `@missionsquad/fastmcp`
- `server.addTool(...)`
- handlers that receive `(args, context)`
- hidden config resolved from `context.extraArgs`

This is the core compatibility change.

## 6.2 Make Client Creation Request-Scoped

Remove startup-time global auth initialization.

Target behavior:

- the MCP server starts without requiring any WordPress credentials
- each tool call resolves hidden/env config at execution time
- each tool call creates or retrieves a client for the current resolved config

Do not keep a global singleton client keyed only to process environment.

## 6.3 Replace SiteManager With A Config Resolver

The current `SiteManager` is the wrong abstraction for MissionSquad hidden injection.

Replace it with a request-scoped resolver that:

- reads hidden values from `context.extraArgs`
- falls back to single-site env vars for local mode
- validates the resolved config
- returns a typed config object

Recommended interface:

```ts
export interface WordPressRequestConfig {
  wordpressUrl: string
  wordpressUsername: string
  wordpressPassword: string
  wordpressSqlEndpoint?: string
}

export function resolveWordPressConfig(
  extraArgs: Record<string, unknown> | undefined,
  defaults: AppConfig,
): WordPressRequestConfig
```

## 6.4 Keep Transport/Auth Separate From Tool Inputs

Tool handlers should not know how WordPress credentials are resolved.

Each tool should do this:

```ts
execute: async (args, context) => {
  const client = createWordPressClient(context.extraArgs)
  return await runTool(client, args)
}
```

Not this:

```ts
execute: async (args) => {
  const username = process.env.WORDPRESS_USERNAME
  const password = process.env.WORDPRESS_PASSWORD
}
```

## 7. File-By-File Refactor Plan

## 7.1 `package.json`

Required changes:

- add `@missionsquad/fastmcp`
- add a test runner such as `vitest`
- add `form-data` if `create_media` URL-upload support remains
- raise the Node engine to `>=20.0.0`
- raise TypeScript to the current MissionSquad standard

Recommended cleanup:

- remove unused `fs-extra`
- remove unused `zod-to-json-schema` if it is no longer needed after the server rewrite

## 7.2 `src/server.ts`

Replace the current manual MCP SDK server bootstrap with a FastMCP server.

Required outcomes:

- no startup `initWordPress()` call
- no startup credential validation
- each tool registered through FastMCP
- handlers receive `context.extraArgs`
- stdout remains reserved for MCP transport

## 7.3 `src/config/site-manager.ts`

Do not carry this file forward unchanged.

Recommended action:

- remove it from the MissionSquad path entirely

If local-only multi-site support must be preserved for non-MissionSquad use, move it behind a separate legacy compatibility module and do not make it part of the MissionSquad hidden-secret path.

## 7.4 `src/wordpress.ts`

Refactor this file into a stateless request/client layer.

Required changes:

- remove global `wpClient`
- remove `initWordPress()`
- stop depending on a global `siteManager`
- add `createWordPressClient(extraArgs)` or `createWordPressClient(config)`
- add `makeWordPressRequest(client, ...)` or a small class that wraps the client

Recommended split:

- `src/config.ts` for hidden/env resolution
- `src/wordpress-client.ts` for Axios client creation and request helpers
- keep `src/wordpress.ts` only if you want a thin compatibility re-export

## 7.5 `src/tools/site-management.ts`

Recommended Phase 1 action:

- remove this module from the MissionSquad tool surface

Reasons:

- it exposes URLs and usernames
- it is built around env-defined site inventories
- it does not fit the one-site-per-user MissionSquad model

If you must keep a diagnostic tool, replace the current surface with one sanitized tool:

- `test_current_site`

Allowed output:

- hostname
- REST base
- connection success/failure

Do not return:

- username
- password
- hidden key names or values
- full site inventory

## 7.6 `src/tools/unified-content.ts`

Required changes:

- remove `site_id` from the public schema in the MissionSquad refactor path
- remove global content-type cache or key it by resolved site identity
- keep all business fields as public tool inputs

If single-site MissionSquad mode is chosen, `site_id` is misleading and should not remain public.

## 7.7 `src/tools/unified-taxonomies.ts`, `plugins.ts`, `media.ts`, `users.ts`, `comments.ts`, `plugin-repository.ts`

Required changes:

- migrate them to the new request-scoped client factory
- keep public business schemas intact where possible
- do not add any auth-bearing public fields

Watch for collisions:

- `users.ts` already uses public `username` and `password`
- `find_content_by_url` and user schemas already use public `url`

That is why hidden key names must stay namespaced as `wordpressUrl`, `wordpressUsername`, and `wordpressPassword`.

## 7.8 `src/tools/sql-query.ts`

Current state:

- exists
- uses `WORDPRESS_SQL_ENDPOINT`
- is not currently included in `src/tools/index.ts`

Recommended decision:

- leave it out of Phase 1 unless you explicitly want to expose SQL querying in MissionSquad

If you do include it later:

- move its endpoint config to hidden/env resolution as `wordpressSqlEndpoint`
- keep it optional

## 7.9 `src/cli.ts`

Either:

- remove this file if it is not needed

or:

- fix the env name mismatch so it uses `WORDPRESS_PASSWORD`

Do not leave the package in a state where CLI docs and runtime expect different password variable names.

## 8. Recommended Target Module Layout

```text
src/
  config.ts
  errors.ts
  index.ts
  server.ts
  stdio-safe-console.ts
  wordpress-client.ts
  tools/
    index.ts
    unified-content.ts
    unified-taxonomies.ts
    plugins.ts
    media.ts
    users.ts
    comments.ts
    plugin-repository.ts
```

Optional:

- `sql-query.ts`

Legacy local-only multi-site support, if kept at all, should live in a clearly isolated compatibility module and should not be the default MissionSquad path.

## 9. Example Hidden Config Resolver

```ts
import { UserError } from '@missionsquad/fastmcp'

export interface AppConfig {
  defaultWordpressUrl?: string
  defaultWordpressUsername?: string
  defaultWordpressPassword?: string
  defaultWordpressSqlEndpoint?: string
}

export interface ResolvedWordPressConfig {
  wordpressUrl: string
  wordpressUsername: string
  wordpressPassword: string
  wordpressSqlEndpoint?: string
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
  if (!trimmed) {
    throw new UserError(`Hidden argument "${key}" must be a non-empty string when provided.`)
  }
  return trimmed
}

export function resolveWordPressConfig(
  extraArgs: Record<string, unknown> | undefined,
  defaults: AppConfig,
): ResolvedWordPressConfig {
  const wordpressUrl =
    readHiddenString(extraArgs, 'wordpressUrl') ?? defaults.defaultWordpressUrl
  const wordpressUsername =
    readHiddenString(extraArgs, 'wordpressUsername') ?? defaults.defaultWordpressUsername
  const wordpressPassword =
    readHiddenString(extraArgs, 'wordpressPassword') ?? defaults.defaultWordpressPassword
  const wordpressSqlEndpoint =
    readHiddenString(extraArgs, 'wordpressSqlEndpoint') ?? defaults.defaultWordpressSqlEndpoint

  if (!wordpressUrl || !wordpressUsername || !wordpressPassword) {
    throw new UserError(
      'WordPress credentials are required. Provide hidden arguments wordpressUrl, wordpressUsername, and wordpressPassword, or configure the local fallback environment.',
    )
  }

  return {
    wordpressUrl,
    wordpressUsername,
    wordpressPassword,
    wordpressSqlEndpoint,
  }
}
```

## 10. Example Request-Scoped WordPress Client

```ts
import axios, { type AxiosInstance } from 'axios'
import { appConfig, resolveWordPressConfig } from './config.js'

function normalizeWordPressBaseUrl(wordpressUrl: string): string {
  const trimmed = wordpressUrl.endsWith('/') ? wordpressUrl : `${wordpressUrl}/`
  if (trimmed.includes('/wp-json/wp/v2/')) {
    return trimmed
  }
  if (trimmed.includes('/wp-json/wp/v2')) {
    return `${trimmed}/`
  }
  return `${trimmed}wp-json/wp/v2/`
}

export function createWordPressClient(
  extraArgs: Record<string, unknown> | undefined,
): AxiosInstance {
  const config = resolveWordPressConfig(extraArgs, appConfig)
  const auth = Buffer.from(
    `${config.wordpressUsername}:${config.wordpressPassword}`,
  ).toString('base64')

  return axios.create({
    baseURL: normalizeWordPressBaseUrl(config.wordpressUrl),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${auth}`,
    },
  })
}
```

## 11. Example FastMCP Tool Wiring

```ts
server.addTool({
  name: 'list_content',
  description: 'Lists WordPress content for the configured site.',
  parameters: z.object({
    content_type: z.string().min(1),
    page: z.number().optional(),
    per_page: z.number().min(1).max(100).optional(),
  }),
  execute: async (args, context) => {
    const client = createWordPressClient(context.extraArgs)
    const response = await client.get(args.content_type, {
      params: {
        page: args.page,
        per_page: args.per_page,
      },
    })

    return JSON.stringify(response.data, null, 2)
  },
})
```

## 12. Validation Requirements

## 12.1 Required Unit Tests

Add tests covering:

1. hidden config overrides env fallback
2. missing hidden/env config fails deterministically
3. wrong-type hidden args fail deterministically
4. hidden keys do not appear in the public tool schema
5. `site-management` removal or replacement works as intended

## 12.2 Required Static Audit

Search the entire package for the chosen hidden keys:

- `wordpressUrl`
- `wordpressUsername`
- `wordpressPassword`
- `wordpressSqlEndpoint`

They must not appear as public tool schema fields.

## 12.3 Required Manual Validation

1. Register the server in MissionSquad with `secretNames`.
2. Save per-user WordPress secrets.
3. Call at least one read tool and one write tool.
4. Confirm the tool works without any public auth fields.
5. Confirm the server can also run locally with env fallback.

## 13. Acceptance Checklist

- [ ] The package uses FastMCP or an equivalent runtime that exposes hidden args cleanly
- [ ] WordPress auth is resolved from hidden args first, env second
- [ ] The server starts without requiring credentials at process boot
- [ ] No global singleton client is keyed only to env config
- [ ] Hidden key names do not collide with any public schema fields
- [ ] Site-management tools no longer expose usernames or hidden site inventories
- [ ] Phase 1 MissionSquad mode is single-site per user
- [ ] README and example config are updated
- [ ] Tests cover hidden config resolution

## 14. Final Recommendation

Do not attempt a minimal patch that keeps the current raw SDK server, startup auth initialization, global `SiteManager`, and env-indexed multi-site model.

That would preserve the exact assumptions that make the package incompatible with MissionSquad hidden secret injection.

The correct refactor is:

1. migrate to FastMCP
2. move auth/config resolution to request time
3. use hidden keys `wordpressUrl`, `wordpressUsername`, and `wordpressPassword`
4. scope MissionSquad v1 to one WordPress site per user
5. treat multi-site support as a later, separate product decision
