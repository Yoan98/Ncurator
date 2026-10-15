import { FREE_MODEL_API_BASE_URL } from './constants'
import type { LLMConfig, LlmProviderKind, LlmRuntimeConfig } from './types'

export const FREE_MODEL_CONFIG_ID_PREFIX = 'free:'

export const FREE_MODEL_CATALOG_CACHE_VERSION = 2

export const FREE_MODEL_CATALOG_TTL_MS = 6 * 60 * 60 * 1000

export const FREE_MODEL_PRICE_LABEL = '免费'

export const FREE_MODEL_NOTICE = '不保证稳定和隐私性'

export type FreeModelCapability = 'text' | 'vision'

/** Full catalog entry from official API (includes secrets). Main-only. */
export type FreeModelCatalogEntry = {
  id: string
  providerKind: LlmProviderKind
  modelName: string
  label: string
  description: string
  capabilities: FreeModelCapability[]
  contextWindowTokens?: number
  iconUrl: string
  baseUrl: string
  apiKey: string
}

export type FreeModelsCatalogResponse = {
  updatedAt: string
  models: FreeModelCatalogEntry[]
}

/** Renderer-safe entry (no apiKey). */
export type FreeModelPublicEntry = {
  id: string
  configId: string
  providerKind: LlmProviderKind
  modelName: string
  label: string
  description: string
  capabilities: FreeModelCapability[]
  contextWindowTokens?: number
  iconUrl: string
}

export type FreeModelsSnapshot = {
  updatedAt: string | null
  fetchedAt: number | null
  models: FreeModelPublicEntry[]
}

export const toFreeModelConfigId = (entryId: string): string =>
  `${FREE_MODEL_CONFIG_ID_PREFIX}${entryId}`

export const isFreeModelConfigId = (configId: string): boolean =>
  configId.startsWith(FREE_MODEL_CONFIG_ID_PREFIX)

export const freeModelEntryIdFromConfigId = (configId: string): string | null => {
  if (!isFreeModelConfigId(configId)) return null
  const id = configId.slice(FREE_MODEL_CONFIG_ID_PREFIX.length).trim()
  return id || null
}

export const parseCatalogContextWindowTokens = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined
  return Math.floor(value)
}

export const toFreeModelPublicEntry = (entry: FreeModelCatalogEntry): FreeModelPublicEntry => ({
  id: entry.id,
  configId: toFreeModelConfigId(entry.id),
  providerKind: entry.providerKind,
  modelName: entry.modelName,
  label: entry.label,
  description: entry.description,
  capabilities: entry.capabilities,
  contextWindowTokens: entry.contextWindowTokens,
  iconUrl: entry.iconUrl
})

export const toFreeModelLlmConfig = (entry: FreeModelCatalogEntry): LLMConfig => ({
  id: toFreeModelConfigId(entry.id),
  name: entry.label,
  providerKind: entry.providerKind,
  base_url: entry.baseUrl,
  api_key: entry.apiKey
})

export const toFreeModelRuntimeConfig = (
  entry: FreeModelCatalogEntry,
  modelName?: string
): LlmRuntimeConfig => ({
  ...toFreeModelLlmConfig(entry),
  model_name: String(modelName || entry.modelName).trim() || entry.modelName
})

export const isFreeModelApiUrl = (value: string): boolean => {
  try {
    const url = new URL(value)
    const base = new URL(FREE_MODEL_API_BASE_URL)
    return (
      url.origin === base.origin &&
      (url.pathname === base.pathname || url.pathname.startsWith(`${base.pathname}/`))
    )
  } catch {
    return false
  }
}
