import type { LlmProviderKind } from './types'
import { normalizeOpenAIBaseUrl } from './llmBaseUrl'

export const LLM_PROVIDER_KINDS: LlmProviderKind[] = [
  'openai',
  'deepseek',
  'openai-compatible'
]

export const isLlmProviderKind = (value: unknown): value is LlmProviderKind =>
  value === 'openai' || value === 'deepseek' || value === 'openai-compatible'

export const inferLlmProviderKind = (baseUrl: string): LlmProviderKind => {
  const normalized = normalizeOpenAIBaseUrl(baseUrl).toLowerCase()
  if (!normalized) return 'openai-compatible'

  try {
    const host = new URL(normalized).host.toLowerCase()
    if (host === 'api.openai.com') return 'openai'
    if (host === 'api.deepseek.com') return 'deepseek'
  } catch {
    if (normalized.includes('api.openai.com')) return 'openai'
    if (normalized.includes('api.deepseek.com')) return 'deepseek'
  }

  return 'openai-compatible'
}

export const resolveLlmProviderKind = (input: {
  providerKind?: string
  baseUrl: string
}): LlmProviderKind =>
  isLlmProviderKind(input.providerKind) ? input.providerKind : inferLlmProviderKind(input.baseUrl)
