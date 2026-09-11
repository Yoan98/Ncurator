import type { LlmProviderId, LlmProviderKind } from './types'
import { normalizeOpenAIBaseUrl } from './llmBaseUrl'

export const LLM_PROVIDER_KINDS: LlmProviderKind[] = [
  'openai',
  'deepseek',
  'openai-compatible'
]

export const isLlmProviderKind = (value: unknown): value is LlmProviderKind =>
  value === 'openai' || value === 'deepseek' || value === 'openai-compatible'

export type LlmProviderRegistryEntry = {
  id: LlmProviderId
  label: string
  hosts: string[]
  providerKind: LlmProviderKind
  defaultBaseUrl: string
}

export type ResolvedLlmProvider = {
  providerId: LlmProviderId
  providerKind: LlmProviderKind
  label: string
}

export const LLM_PROVIDER_REGISTRY: LlmProviderRegistryEntry[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    hosts: ['api.deepseek.com'],
    providerKind: 'deepseek',
    defaultBaseUrl: 'https://api.deepseek.com'
  },
  {
    id: 'dashscope',
    label: '通义千问',
    hosts: ['dashscope.aliyuncs.com', 'maas.aliyuncs.com'],
    providerKind: 'openai-compatible',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1'
  },
  {
    id: 'mimo',
    label: '小米 MiMo',
    hosts: ['api.xiaomimimo.com', 'token-plan-cn.xiaomimimo.com'],
    providerKind: 'openai-compatible',
    defaultBaseUrl: 'https://api.xiaomimimo.com/v1'
  },
  {
    id: 'zhipu',
    label: '智谱 GLM',
    hosts: ['open.bigmodel.cn', 'api.z.ai'],
    providerKind: 'openai-compatible',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4'
  }
]

const isLocalHost = (host: string): boolean =>
  host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1'

const hostMatches = (host: string, knownHost: string): boolean =>
  host === knownHost || host.endsWith(`.${knownHost}`)

export const resolveLlmProvider = (baseUrl: string): ResolvedLlmProvider => {
  const normalized = normalizeOpenAIBaseUrl(baseUrl).toLowerCase()
  if (!normalized) {
    return {
      providerId: 'custom',
      providerKind: 'openai-compatible',
      label: '自定义'
    }
  }

  try {
    const host = new URL(normalized).hostname.toLowerCase()
    const matched = LLM_PROVIDER_REGISTRY.find((provider) =>
      provider.hosts.some((knownHost) => hostMatches(host, knownHost))
    )
    if (matched) {
      return {
        providerId: matched.id,
        providerKind: matched.providerKind,
        label: matched.label
      }
    }
    if (isLocalHost(host)) {
      return {
        providerId: 'local',
        providerKind: 'openai-compatible',
        label: '本地模型'
      }
    }
  } catch {
    return {
      providerId: 'custom',
      providerKind: 'openai-compatible',
      label: '自定义'
    }
  }

  return {
    providerId: 'custom',
    providerKind: 'openai-compatible',
    label: '自定义'
  }
}

export const inferLlmProviderKind = (baseUrl: string): LlmProviderKind => {
  return resolveLlmProvider(baseUrl).providerKind
}

export const resolveLlmProviderKind = (input: {
  providerKind?: string
  baseUrl: string
}): LlmProviderKind => {
  if (isLlmProviderKind(input.providerKind)) {
    return input.providerKind
  }
  throw new Error('llm_config_invalid_provider_kind')
}