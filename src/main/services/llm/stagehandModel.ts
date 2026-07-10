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
  model: StagehandClientOptions & {
    modelName: `${StagehandProvider}/${string}`
  }
}

const STAGEHAND_PROVIDER_MAP: Record<StagehandSupportedProviderKind, StagehandProvider> = {
  openai: 'openai',
  deepseek: 'deepseek',
  'openai-compatible': 'openai'
}

const inferOpenAICompatibleStagehandProvider = (modelName: string): StagehandProvider => {
  const normalizedModelName = modelName.trim().toLowerCase()
  if (normalizedModelName.startsWith('deepseek') || normalizedModelName.includes('/deepseek')) {
    return 'deepseek'
  }
  return 'openai'
}

export const resolveStagehandModelConfig = (config: LlmRuntimeConfig): StagehandModelConfig => {
  const runtimeOptions = resolveOpenAICompatibleRuntimeOptions(config, {
    consumerName: 'browser_use'
  })
  const providerKind = runtimeOptions.providerKind
  const provider =
    providerKind === 'openai-compatible'
      ? inferOpenAICompatibleStagehandProvider(runtimeOptions.modelName)
      : STAGEHAND_PROVIDER_MAP[providerKind]
  const model: StagehandModelConfig['model'] = {
    modelName: `${provider}/${runtimeOptions.modelName}`,
    apiKey: runtimeOptions.apiKey,
    baseURL: runtimeOptions.baseURL
  }
  return {
    providerKind,
    provider,
    model
  }
}
