import type { LLMConfig, LlmProviderId } from './types'
import { parseCatalogContextWindowTokens } from './freeModels'
import { parseEffort } from './llmEffort'
import { LLM_PROVIDER_REGISTRY, resolveLlmProvider } from './llmProvider'

export type LlmPriceTier = 'low' | 'mid' | 'high'

/**
 * 思考强度档位。取值即上游 `reasoning_effort`，不做本地映射。
 * 目录未开放或模型不支持时为 `undefined`，界面不显示强度控件。
 */
export type LlmEffortOption = { value: string; label: string }
export type LlmEffort = { default: string; options: LlmEffortOption[] }

export type LlmPresetModel = {
  id: string
  label: string
  iconUrl: string
  priceTier: LlmPriceTier
  description: string
  capabilities: Array<'text' | 'vision'>
  contextWindowTokens?: number
  effort?: LlmEffort
}

export type LlmPresetProviderId = Exclude<LlmProviderId, 'local' | 'custom'>

/** Local provider meta only (no recommended models — those come from remote catalog). */
export type LlmPresetProviderMeta = {
  providerId: LlmPresetProviderId
  label: string
}

/** Remote catalog provider row merged with local label. */
export type LlmPresetProvider = LlmPresetProviderMeta & {
  models: LlmPresetModel[]
}

export const PRESET_MODEL_CATALOG_TTL_MS = 6 * 60 * 60 * 1000

export type PresetCatalogModelPayload = LlmPresetModel

export type PresetCatalogProviderPayload = {
  providerId: LlmPresetProviderId
  models: PresetCatalogModelPayload[]
}

export type PresetModelsCatalogResponse = {
  updatedAt: string
  providers: PresetCatalogProviderPayload[]
}

export type PresetModelsSnapshot = {
  updatedAt: string | null
  fetchedAt: number | null
  providers: LlmPresetProvider[]
}

const PRESET_PROVIDER_IDS = new Set<LlmPresetProviderId>(['deepseek', 'dashscope', 'mimo', 'zhipu'])

export const isLlmPresetProviderId = (value: string): value is LlmPresetProviderId =>
  PRESET_PROVIDER_IDS.has(value as LlmPresetProviderId)

/** Settings dropdown: preset vendors from local registry (no model list). */
export const LLM_PRESET_PROVIDER_OPTIONS: LlmPresetProviderMeta[] = LLM_PROVIDER_REGISTRY.filter(
  (entry): entry is (typeof LLM_PROVIDER_REGISTRY)[number] & { id: LlmPresetProviderId } =>
    isLlmPresetProviderId(entry.id)
).map((entry) => ({
  providerId: entry.id,
  label: entry.label
}))

export const getPresetProvider = (providerId: LlmProviderId): LlmPresetProviderMeta | null => {
  if (!isLlmPresetProviderId(providerId)) return null
  const entry = LLM_PROVIDER_REGISTRY.find((item) => item.id === providerId)
  return entry ? { providerId, label: entry.label } : null
}

export const getPresetModel = (
  provider: Pick<LlmPresetProvider, 'models'>,
  modelId: string
): LlmPresetModel | null => provider.models.find((model) => model.id === modelId) || null

export const getPresetProviderByBaseUrl = (baseUrl: string): LlmPresetProviderMeta | null => {
  const resolved = resolveLlmProvider(baseUrl)
  return getPresetProvider(resolved.providerId)
}

export const getProviderRegistryEntry = (providerId: LlmProviderId) =>
  LLM_PROVIDER_REGISTRY.find((provider) => provider.id === providerId) || null

export const getPresetProviderLabel = (providerId: LlmProviderId): string =>
  getPresetProvider(providerId)?.label || getProviderRegistryEntry(providerId)?.label || ''

export const resolvePresetModeProvider = (
  config: Pick<LLMConfig, 'providerKind' | 'name' | 'base_url'>
): LlmPresetProviderMeta | null => {
  const provider = getPresetProviderByBaseUrl(config.base_url)
  if (!provider) return null
  if (config.name.trim() !== provider.label) return null
  return provider
}

export const emptyPresetModelsSnapshot = (): PresetModelsSnapshot => ({
  updatedAt: null,
  fetchedAt: null,
  providers: []
})

/** Merge remote catalog rows with local provider labels from registry. */
export const mergePresetCatalogProviders = (
  remote: readonly PresetCatalogProviderPayload[]
): LlmPresetProvider[] => {
  const result: LlmPresetProvider[] = []
  for (const entry of remote) {
    if (!isLlmPresetProviderId(entry.providerId)) continue
    if (!Array.isArray(entry.models) || entry.models.length === 0) continue
    const meta = getPresetProvider(entry.providerId)
    if (!meta) continue
    const models: LlmPresetModel[] = []
    for (const model of entry.models) {
      const id = String(model.id || '').trim()
      const label = String(model.label || '').trim()
      const iconUrl = String(model.iconUrl || '').trim()
      const priceTier = model.priceTier
      if (!id || !label || !iconUrl) continue
      if (priceTier !== 'low' && priceTier !== 'mid' && priceTier !== 'high') continue
      const capabilities = Array.isArray(model.capabilities)
        ? model.capabilities.filter(
            (item): item is 'text' | 'vision' => item === 'text' || item === 'vision'
          )
        : []
      if (capabilities.length === 0) continue
      /*
       * effort 必须一起带过来。
       *
       * 这里原先是逐个字段重建对象，漏掉了 effort —— 后端下发了档位、
       * 解析层也读到了，但在这里被丢掉。表现就是「馆长模型有强度、
       * 自定义模型全都没有」，而且缓存里查不到任何 effort 痕迹。
       */
      const effort = parseEffort((model as { effort?: unknown }).effort)
      models.push({
        id,
        label,
        iconUrl,
        priceTier,
        description: typeof model.description === 'string' ? model.description.trim() : '',
        capabilities,
        contextWindowTokens: parseCatalogContextWindowTokens(model.contextWindowTokens),
        ...(effort && { effort })
      })
    }
    if (models.length === 0) continue
    result.push({
      providerId: entry.providerId,
      label: meta.label,
      models
    })
  }
  return result
}
