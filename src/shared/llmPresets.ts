import type { LLMConfig, LlmProviderId } from './types'
import { LLM_PROVIDER_REGISTRY, resolveLlmProvider } from './llmProvider'

export type LlmPriceTier = 'low' | 'mid' | 'high'

export const LLM_PRICE_TIER_LABELS: Record<LlmPriceTier, string> = {
  low: '便宜',
  mid: '有点贵',
  high: '贵'
}

export type LlmPresetModel = {
  id: string
  label: string
  priceTier: LlmPriceTier
}

export type LlmPresetProvider = {
  providerId: LlmProviderId
  label: string
  models: LlmPresetModel[]
  sourceUrl: string
  checkedAt: string
}

export const LLM_PRESET_PROVIDERS: LlmPresetProvider[] = [
  {
    providerId: 'deepseek',
    label: 'DeepSeek',
    sourceUrl: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing',
    checkedAt: '2026-08-28',
    models: [
      { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', priceTier: 'mid' },
      { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', priceTier: 'low' },
      {
        id: 'deepseek-v4-flash-vision-exp',
        label: 'DeepSeek V4 Flash Vision',
        priceTier: 'low'
      }
    ]
  },
  {
    providerId: 'dashscope',
    label: '通义千问',
    sourceUrl: 'https://www.qianwenai.com/models',
    checkedAt: '2026-08-28',
    models: [
      { id: 'qwen3.8-max', label: 'Qwen3.8 Max', priceTier: 'high' },
      { id: 'qwen3.8-flash', label: 'Qwen3.8 Flash', priceTier: 'low' }
    ]
  },
  {
    providerId: 'mimo',
    label: '小米 MiMo',
    sourceUrl: 'https://mimo.mi.com/docs/zh-CN/quick-start/summary/model',
    checkedAt: '2026-08-28',
    models: [
      { id: 'mimo-v2.5-pro', label: 'MiMo V2.5 Pro', priceTier: 'mid' },
      { id: 'mimo-v2.5', label: 'MiMo V2.5', priceTier: 'low' }
    ]
  },
  {
    providerId: 'zhipu',
    label: '智谱 GLM',
    sourceUrl: 'https://docs.bigmodel.cn/cn/guide/start/model-overview',
    checkedAt: '2026-08-28',
    models: [
      { id: 'glm-5.3', label: 'GLM 5.3', priceTier: 'high' },
      { id: 'glm-5.3-flash', label: 'GLM 5.3 Flash', priceTier: 'low' }
    ]
  },
  {
    providerId: 'moonshot',
    label: 'Kimi',
    sourceUrl: 'https://platform.kimi.com/docs/pricing/chat-k3',
    checkedAt: '2026-08-28',
    models: [
      { id: 'kimi-k3', label: 'Kimi K3', priceTier: 'high' },
      { id: 'kimi-k2.6', label: 'Kimi K2.6', priceTier: 'mid' }
    ]
  }
]

export const getPresetProvider = (providerId: LlmProviderId): LlmPresetProvider | null =>
  LLM_PRESET_PROVIDERS.find((provider) => provider.providerId === providerId) || null

export const getPresetModel = (
  provider: LlmPresetProvider,
  modelId: string
): LlmPresetModel | null => provider.models.find((model) => model.id === modelId) || null

export const getPresetProviderByBaseUrl = (baseUrl: string): LlmPresetProvider | null => {
  const resolved = resolveLlmProvider(baseUrl)
  return getPresetProvider(resolved.providerId)
}

export const isPresetProviderId = (providerId: LlmProviderId): boolean =>
  getPresetProvider(providerId) !== null

export const getProviderRegistryEntry = (providerId: LlmProviderId) =>
  LLM_PROVIDER_REGISTRY.find((provider) => provider.id === providerId) || null

export const getPresetProviderLabel = (providerId: LlmProviderId): string =>
  getPresetProvider(providerId)?.label || getProviderRegistryEntry(providerId)?.label || ''

export const resolvePresetModeProvider = (
  config: Pick<LLMConfig, 'providerKind' | 'name' | 'base_url'>
): LlmPresetProvider | null => {
  const provider = getPresetProviderByBaseUrl(config.base_url)
  if (!provider) return null
  return provider
}
