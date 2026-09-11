import type { LiveLlmConfig } from './test-types'
import { resolveLiveLlmTarget } from '../core/liveProviders'

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
