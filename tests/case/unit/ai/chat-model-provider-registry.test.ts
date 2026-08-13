import { describe, expect, it } from 'vitest'
import { createChatModel } from '../../../../src/main/services/llm/chatModel'
import { AI_LLM_CALL_TIMEOUT_MS } from '../../../../src/main/services/ai/constants'
import type { LlmRuntimeConfig } from '../../../../src/shared/types'

const buildConfig = (input: Partial<LlmRuntimeConfig>): LlmRuntimeConfig => ({
  id: 'cfg',
  name: 'Provider Registry Config',
  providerKind: 'openai-compatible',
  base_url: 'https://example.test/v1',
  model_name: 'test-model',
  api_key: 'test-key',
  ...input
})

describe('ai unit chat model provider registry', () => {
  it('uses the responses API only for official OpenAI provider configs', () => {
    const openaiModel = createChatModel(
      buildConfig({ providerKind: 'openai', base_url: 'https://api.openai.com/v1' })
    ) as { useResponsesApi?: boolean; fields?: { useResponsesApi?: boolean } }
    const compatibleModel = createChatModel(buildConfig({ providerKind: 'openai-compatible' })) as {
      useResponsesApi?: boolean
      fields?: { useResponsesApi?: boolean }
    }

    expect(openaiModel.useResponsesApi ?? openaiModel.fields?.useResponsesApi).toBe(true)
    expect(compatibleModel.useResponsesApi ?? compatibleModel.fields?.useResponsesApi).toBe(false)
  })

  it('creates provider-specific chat model classes', () => {
    expect(
      createChatModel(
        buildConfig({ providerKind: 'openai', base_url: 'https://api.openai.com/v1' })
      ).constructor.name
    ).toBe('ChatOpenAI')
    expect(
      createChatModel(
        buildConfig({ providerKind: 'deepseek', base_url: 'https://api.deepseek.com/v1' })
      ).constructor.name
    ).toBe('ChatDeepSeek')
    expect(
      createChatModel(buildConfig({ providerKind: 'openai-compatible' })).constructor.name
    ).toBe('ChatOpenAI')
  })

  it('forces provider retries to zero and accepts explicit timeout', () => {
    const model = createChatModel(buildConfig({ providerKind: 'openai' }), {
      timeout: AI_LLM_CALL_TIMEOUT_MS
    }) as {
      timeout?: number
      caller?: { maxRetries?: number }
      fields?: { maxRetries?: number }
    }

    expect(model.caller?.maxRetries ?? model.fields?.maxRetries).toBe(0)
    expect(model.timeout).toBe(AI_LLM_CALL_TIMEOUT_MS)
  })
})
