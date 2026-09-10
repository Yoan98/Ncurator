import type { LLMConfig, LlmProviderKind, LlmRuntimeConfig } from './types'

export const FREE_MODEL_CONFIG_ID_PREFIX = 'free:'

export const FREE_MODEL_CATALOG_TTL_MS = 6 * 60 * 60 * 1000

export const FREE_MODEL_PRICE_LABEL = '免费'

export const FREE_MODEL_NOTICE = '不保证稳定和隐私性'

export type FreeModelCapability = 'text' | 'vision'

/**
 * Free-catalog brand slug from official API.
 * Not the same as desktop settings `LlmProviderId` (presets / URL inference).
 */
export type FreeModelProviderId = string

const FREE_MODEL_PROVIDER_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/

export const isFreeModelProviderId = (value: string): boolean =>
  FREE_MODEL_PROVIDER_ID_PATTERN.test(value)

/** Full catalog entry from official API (includes secrets). Main-only. */
export type FreeModelCatalogEntry = {
  id: string
  providerId: FreeModelProviderId
  providerKind: LlmProviderKind
  modelName: string
  label: string
  description: string
  capabilities: FreeModelCapability[]
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
  providerId: FreeModelCatalogEntry['providerId']
  providerKind: LlmProviderKind
  modelName: string
  label: string
  description: string
  capabilities: FreeModelCapability[]
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

export const toFreeModelPublicEntry = (entry: FreeModelCatalogEntry): FreeModelPublicEntry => ({
  id: entry.id,
  configId: toFreeModelConfigId(entry.id),
  providerId: entry.providerId,
  providerKind: entry.providerKind,
  modelName: entry.modelName,
  label: entry.label,
  description: entry.description,
  capabilities: entry.capabilities,
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
