import type { ClientOptions as StagehandClientOptions } from '@browserbasehq/stagehand'
import type { LlmRuntimeConfig } from '../../../shared/types'
import { resolveOpenAICompatibleRuntimeOptions } from './openaiCompatible'
import { StagehandLangChainClient } from './stagehandLangChainClient'

type StagehandProvider = 'openai' | 'deepseek'

export type StagehandRuntimeModel =
  | {
      mode: 'stagehand-model'
      provider: StagehandProvider
      model: StagehandClientOptions & {
        modelName: `${StagehandProvider}/${string}`
      }
    }
  | {
      mode: 'langchain-client'
      provider: 'openai-compatible'
      llmClient: StagehandLangChainClient
    }

export const resolveStagehandRuntimeModel = (config: LlmRuntimeConfig): StagehandRuntimeModel => {
  const runtimeOptions = resolveOpenAICompatibleRuntimeOptions(config, {
    consumerName: 'browser_use'
  })

  if (runtimeOptions.providerKind === 'openai' || runtimeOptions.providerKind === 'deepseek') {
    const provider = runtimeOptions.providerKind
    return {
      mode: 'stagehand-model',
      provider,
      model: {
        modelName: `${provider}/${runtimeOptions.modelName}`,
        apiKey: runtimeOptions.apiKey,
        baseURL: runtimeOptions.baseURL
      }
    }
  }

  return {
    mode: 'langchain-client',
    provider: 'openai-compatible',
    llmClient: new StagehandLangChainClient(config)
  }
}
