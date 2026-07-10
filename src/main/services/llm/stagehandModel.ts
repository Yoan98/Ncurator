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
    modelName: string
    provider?: StagehandProvider
  }
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
  const modelName =
    providerKind === 'openai-compatible'
      ? runtimeOptions.modelName
      : `${provider}/${runtimeOptions.modelName}`
  const model: StagehandModelConfig['model'] = {
    modelName,
    apiKey: runtimeOptions.apiKey,
    baseURL: runtimeOptions.baseURL
  }
  if (providerKind === 'openai-compatible') {
    model.provider = 'openai'
  }
  return {
    providerKind,
    provider,
    model
  }
}
