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
  official: boolean
  hosts: string[]
  providerKind: LlmProviderKind
}

export type ResolvedLlmProvider = {
  providerId: LlmProviderId
  providerKind: LlmProviderKind
  label: string
}

export const LLM_PROVIDER_REGISTRY: LlmProviderRegistryEntry[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    official: true,
    hosts: ['api.openai.com'],
    providerKind: 'openai'
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    official: true,
    hosts: ['api.deepseek.com'],
    providerKind: 'deepseek'
  },
  {
    id: 'dashscope',
    label: '阿里云百炼',
    official: false,
    hosts: ['dashscope.aliyuncs.com', 'maas.aliyuncs.com'],
    providerKind: 'openai-compatible'
  },
  {
    id: 'volcengine',
    label: '火山方舟',
    official: false,
    hosts: ['ark.cn-beijing.volces.com'],
    providerKind: 'openai-compatible'
  },
  {
    id: 'moonshot',
    label: 'Kimi',
    official: false,
    hosts: ['api.moonshot.cn'],
    providerKind: 'openai-compatible'
  },
  {
    id: 'siliconflow',
    label: '硅基流动',
    official: false,
    hosts: ['api.siliconflow.cn'],
    providerKind: 'openai-compatible'
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    official: false,
    hosts: ['openrouter.ai'],
    providerKind: 'openai-compatible'
  },
  {
    id: 'zhipu',
    label: '智谱 AI',
    official: false,
    hosts: ['open.bigmodel.cn', 'api.z.ai'],
    providerKind: 'openai-compatible'
  },
  {
    id: 'baidu-qianfan',
    label: '百度千帆',
    official: false,
    hosts: ['qianfan.baidubce.com', 'api.baiduqianfan.ai'],
    providerKind: 'openai-compatible'
  },
  {
    id: 'tencent-hunyuan',
    label: '腾讯混元',
    official: false,
    hosts: ['api.hunyuan.cloud.tencent.com'],
    providerKind: 'openai-compatible'
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    official: false,
    hosts: ['api.minimax.io', 'api.minimaxi.com'],
    providerKind: 'openai-compatible'
  },
  {
    id: 'yi',
    label: '零一万物',
    official: false,
    hosts: ['api.lingyiwanwu.com'],
    providerKind: 'openai-compatible'
  },
  {
    id: 'nvidia-nim',
    label: 'NVIDIA NIM',
    official: false,
    hosts: ['integrate.api.nvidia.com'],
    providerKind: 'openai-compatible'
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
}): LlmProviderKind => inferLlmProviderKind(input.baseUrl)
