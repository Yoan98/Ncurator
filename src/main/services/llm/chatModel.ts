import { ChatOpenAI } from '@langchain/openai'
import { ChatDeepSeek } from '@langchain/deepseek'
import type { LlmRuntimeConfig } from '../../types/store'
import type { AiStructuredOutputTransport } from '../../../shared/types'
import { resolveLlmProviderKind } from '../../../shared/llmProvider'
import { resolveOpenAICompatibleRuntimeOptions } from './openaiCompatible'

export type ChatModelFactoryOptions = {
  temperature?: number
  timeout?: number
  transport?: AiStructuredOutputTransport
  streaming?: boolean
}

export const getSupportedTransportsForConfig = (
  cfg: LlmRuntimeConfig
): AiStructuredOutputTransport[] =>
  resolveLlmProviderKind({
    providerKind: cfg.providerKind,
    baseUrl: cfg.base_url
  }) === 'openai'
    ? ['responses', 'completions']
    : ['completions']

export const createChatModel = (cfg: LlmRuntimeConfig, opts?: ChatModelFactoryOptions) => {
  const providerKind = resolveLlmProviderKind({
    providerKind: cfg.providerKind,
    baseUrl: cfg.base_url
  })
  if (providerKind === 'deepseek') {
    return new ChatDeepSeek({
      model: cfg.model_name,
      apiKey: cfg.api_key,
      temperature: opts?.temperature ?? 0.2,
      maxRetries: 0,
      timeout: opts?.timeout,
      streaming: opts?.streaming === true
    })
  }

  const runtimeOptions = resolveOpenAICompatibleRuntimeOptions(cfg, {
    consumerName: 'chat_model',
    supportedProviderKinds: ['openai', 'openai-compatible']
  })

  return new ChatOpenAI({
    model: runtimeOptions.modelName,
    apiKey: runtimeOptions.apiKey,
    useResponsesApi: opts?.transport === 'responses',
    temperature: opts?.temperature ?? 0.2,
    maxRetries: 0,
    timeout: opts?.timeout,
    streaming: opts?.streaming === true,
    configuration: {
      baseURL: runtimeOptions.baseURL
    }
  })
}
