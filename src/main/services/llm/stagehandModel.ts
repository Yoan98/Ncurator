import type { ClientOptions as StagehandClientOptions } from '@browserbasehq/stagehand'
import type { LlmRuntimeConfig } from '../../../shared/types'
import {
  resolveOpenAICompatibleRuntimeOptions,
  type OpenAICompatibleProviderKind
} from './openaiCompatible'

type StagehandSupportedProviderKind = OpenAICompatibleProviderKind

type StagehandProvider = 'openai' | 'deepseek'

export type StagehandModelConfig = {
  providerKind: StagehandSupportedProviderKind
  provider: StagehandProvider
  modelName: `${StagehandProvider}/${string}`
  clientOptions: StagehandClientOptions
}

const STAGEHAND_PROVIDER_MAP: Record<StagehandSupportedProviderKind, StagehandProvider> = {
  openai: 'openai',
  deepseek: 'deepseek',
  'openai-compatible': 'openai'
}

export const resolveStagehandModelConfig = (config: LlmRuntimeConfig): StagehandModelConfig => {
  const runtimeOptions = resolveOpenAICompatibleRuntimeOptions(config, {
    consumerName: 'browser_use'
  })
  const providerKind = runtimeOptions.providerKind
  const provider = STAGEHAND_PROVIDER_MAP[providerKind]
  return {
    providerKind,
    provider,
    modelName: `${provider}/${runtimeOptions.modelName}`,
    clientOptions: {
      apiKey: runtimeOptions.apiKey,
      baseURL: runtimeOptions.baseURL
    }
  }
}
