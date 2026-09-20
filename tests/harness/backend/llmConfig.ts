import type { LiveLlmConfig } from './test-types'
import { resolveLiveLlmTarget } from '../core/liveProviders'

/** Placeholder config id for tool-real cases. Must not resolve live env / LangSmith. */
export const TOOL_REAL_LLM_CONFIG_ID = 'tool-real-local'

export const loadLiveLlmConfigFromEnv = (): LiveLlmConfig => {
  const target = resolveLiveLlmTarget()
  return {
    id: `ai-live-${target.providerId}`,
    name: target.label,
    providerKind: target.providerKind,
    base_url: target.baseUrl,
    model_name: target.modelName,
    api_key: target.apiKey
  }
}
