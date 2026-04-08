#!/usr/bin/env node

import { z } from 'zod'
import { FastMCP } from '@missionsquad/fastmcp'
import { allTools, toolHandlers } from './tools/index.js'
import { toUserError } from './errors.js'
import { runWithRequestContext } from './request-context.js'
import { routeConsoleStdoutToStderr } from './stdio-safe-console.js'
import { initWordPress } from './wordpress.js'

routeConsoleStdoutToStderr()

const server = new FastMCP<undefined>({
  name: 'wordpress',
  version: '0.0.3',
})

function extractToolText(result: unknown): string {
  const toolResult = (result as { toolResult?: { content?: Array<{ text?: string }>; isError?: boolean } })?.toolResult
  const text = toolResult?.content
    ?.map((item) => item.text)
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join('\n\n')

  if (toolResult?.isError) {
    throw new Error(text || 'Tool execution failed.')
  }

  return text || JSON.stringify(result, null, 2)
}

for (const tool of allTools) {
  const handler = toolHandlers[tool.name as keyof typeof toolHandlers]
  if (!handler) {
    continue
  }

  const parameters = z.object(tool.inputSchema.properties as z.ZodRawShape)

  server.addTool({
    name: tool.name,
    description: tool.description ?? '',
    parameters,
    execute: async (args, context) => {
      try {
        return await runWithRequestContext(context.extraArgs, async () => {
          const result = await (handler as (params: unknown) => Promise<unknown>)(args)
          return extractToolText(result)
        })
      } catch (error) {
        throw toUserError(error, `Tool ${tool.name} failed`)
      }
    },
  })
}

async function main(): Promise<void> {
  await initWordPress()
  await server.start({ transportType: 'stdio' })
}

async function shutdown(exitCode: number): Promise<void> {
  try {
    await server.stop()
  } finally {
    process.exit(exitCode)
  }
}

process.on('SIGINT', () => {
  void shutdown(0)
})

process.on('SIGTERM', () => {
  void shutdown(0)
})

process.on('uncaughtException', () => {
  void shutdown(1)
})

process.on('unhandledRejection', () => {
  void shutdown(1)
})

void main().catch(() => {
  void shutdown(1)
})

