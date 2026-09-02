import type { LLMConfig, LlmProviderId } from './types'
import { LLM_PROVIDER_REGISTRY, resolveLlmProvider } from './llmProvider'

export type LlmPriceTier = 'low' | 'mid' | 'high'

export type LlmPresetModel = {
  id: string
  label: string
  priceTier: LlmPriceTier
  description: string
  capabilities: Array<'text' | 'vision'>
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
      {
        id: 'deepseek-v4-pro',
        label: 'DeepSeek V4 Pro',
        priceTier: 'mid',
        description: '面向复杂推理、代码与长任务的高质量模型。',
        capabilities: ['text']
      },
      {
        id: 'deepseek-v4-flash',
        label: 'DeepSeek V4 Flash',
        priceTier: 'low',
        description: '响应更快，适合日常问答和轻量任务。',
        capabilities: ['text']
      },
      {
        id: 'deepseek-v4-flash-vision-exp',
        label: 'DeepSeek V4 Flash Vision',
        priceTier: 'low',
        description: '兼顾快速响应，并可理解图片内容。',
        capabilities: ['text', 'vision']
      }
    ]
  },
  {
    providerId: 'dashscope',
    label: '通义千问',
    sourceUrl: 'https://www.qianwenai.com/models',
    checkedAt: '2026-08-28',
    models: [
      {
        id: 'qwen3.8-max',
        label: 'Qwen3.8 Max',
        priceTier: 'high',
        description: '适合复杂知识、代码和多模态任务。',
        capabilities: ['text', 'vision']
      },
      {
        id: 'qwen3.8-flash',
        label: 'Qwen3.8 Flash',
        priceTier: 'low',
        description: '强调速度与成本，支持常用多模态任务。',
        capabilities: ['text', 'vision']
      }
    ]
  },
  {
    providerId: 'mimo',
    label: '小米 MiMo',
    sourceUrl: 'https://mimo.mi.com/docs/zh-CN/quick-start/summary/model',
    checkedAt: '2026-08-28',
    models: [
      {
        id: 'mimo-v2.5-pro',
        label: 'MiMo V2.5 Pro',
        priceTier: 'mid',
        description: '适合较复杂的推理、代码和知识工作。',
        capabilities: ['text']
      },
      {
        id: 'mimo-v2.5',
        label: 'MiMo V2.5',
        priceTier: 'low',
        description: '面向高频日常任务，兼顾图片理解。',
        capabilities: ['text', 'vision']
      }
    ]
  },
  {
    providerId: 'zhipu',
    label: '智谱 GLM',
    sourceUrl: 'https://docs.bigmodel.cn/cn/guide/start/model-overview',
    checkedAt: '2026-08-28',
    models: [
      {
        id: 'glm-5.3',
        label: 'GLM 5.3',
        priceTier: 'high',
        description: '面向高难度推理、代码和专业任务。',
        capabilities: ['text']
      },
      {
        id: 'glm-5.3-flash',
        label: 'GLM 5.3 Flash',
        priceTier: 'low',
        description: '快速、经济，支持图片理解。',
        capabilities: ['text', 'vision']
      }
    ]
  },
  {
    providerId: 'moonshot',
    label: 'Kimi',
    sourceUrl: 'https://platform.kimi.com/docs/pricing/chat-k3',
    checkedAt: '2026-08-28',
    models: [
      {
        id: 'kimi-k3',
        label: 'Kimi K3',
        priceTier: 'high',
        description: '适合长上下文、复杂推理与多模态工作。',
        capabilities: ['text', 'vision']
      },
      {
        id: 'kimi-k2.6',
        label: 'Kimi K2.6',
        priceTier: 'mid',
        description: '兼顾质量和速度，支持图片理解。',
        capabilities: ['text', 'vision']
      }
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
  if (config.name.trim() !== provider.label) return null
  return provider
}
