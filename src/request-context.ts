import { AsyncLocalStorage } from 'node:async_hooks'
import type { AxiosInstance } from 'axios'
import { appConfig, resolveWordPressRequestConfig, type ResolvedWordPressRequestConfig } from './config.js'

interface RequestContextState {
  extraArgs?: Record<string, unknown>
  config?: ResolvedWordPressRequestConfig
  client?: AxiosInstance
}

const requestContextStorage = new AsyncLocalStorage<RequestContextState>()

function getState(): RequestContextState {
  const state = requestContextStorage.getStore()
  if (!state) {
    throw new Error('WordPress request context is not initialized for this tool call.')
  }
  return state
}

export async function runWithRequestContext<T>(
  extraArgs: Record<string, unknown> | undefined,
  callback: () => Promise<T>,
): Promise<T> {
  return await requestContextStorage.run({ extraArgs }, callback)
}

export function getCurrentRequestConfig(): ResolvedWordPressRequestConfig {
  const state = getState()
  if (!state.config) {
    state.config = resolveWordPressRequestConfig(state.extraArgs, appConfig)
  }
  return state.config
}

export function getCurrentRequestClient(): AxiosInstance | undefined {
  return getState().client
}

export function setCurrentRequestClient(client: AxiosInstance): void {
  getState().client = client
}

