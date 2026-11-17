import { ChatOpenAI } from '@langchain/openai'
import { ChatDeepSeek } from '@langchain/deepseek'
import type { LlmRuntimeConfig } from '../../types/store'
import { resolveLlmProviderKind } from '../../../shared/llmProvider'
import { resolveOpenAICompatibleRuntimeOptions } from './openaiCompatible'
import { createFreeModelFetch } from '../officialApi/appClient'
import { isFreeModelConfigId } from '../../../shared/freeModels'
import { createManagedModelFetch, isManagedModelConfigId } from '../officialApi/managedModel'

export type ChatModelFactoryOptions = {
  temperature?: number
  timeout?: number
  streaming?: boolean
}

export const createChatModel = (cfg: LlmRuntimeConfig, opts?: ChatModelFactoryOptions) => {
  const providerKind = resolveLlmProviderKind({
    providerKind: cfg.providerKind,
    baseUrl: cfg.base_url
  })
  const managed = isManagedModelConfigId(cfg.id)
  if (managed && providerKind !== 'openai-compatible') throw new Error('馆长模型配置无效')
  // 思考强度只能经 modelKwargs 下发：ChatOpenAI 的 reasoningEffort 选项只对 o*/gpt-5*
  // 生效（isReasoningModel），deepseek/glm 型号会被静默丢弃。
  const effortKwargs = cfg.effort ? { modelKwargs: { reasoning_effort: cfg.effort } } : {}
  if (providerKind === 'deepseek') {
    return new ChatDeepSeek({
      model: cfg.model_name,
      apiKey: cfg.api_key,
      temperature: opts?.temperature ?? 0.2,
      maxRetries: 0,
      timeout: opts?.timeout,
      streaming: opts?.streaming === true,
      ...effortKwargs
    })
  }

  const runtimeOptions = resolveOpenAICompatibleRuntimeOptions(cfg, {
    consumerName: 'chat_model',
    supportedProviderKinds: ['openai', 'openai-compatible']
  })

  return new ChatOpenAI({
    model: runtimeOptions.modelName,
    apiKey: runtimeOptions.apiKey,
    useResponsesApi: providerKind === 'openai',
    temperature: opts?.temperature ?? 0.2,
    maxRetries: 0,
    timeout: opts?.timeout,
    streaming: opts?.streaming === true,
    ...effortKwargs,
    configuration: {
      baseURL: runtimeOptions.baseURL,
      ...(managed ? { fetch: createManagedModelFetch(cfg) }
        : isFreeModelConfigId(cfg.id) ? { fetch: createFreeModelFetch(cfg.base_url) } : {})
    }
  })
}
