import { describe, expect, it } from 'vitest'
import { createChatModel, getSupportedTransportsForConfig } from '../../../src/main/services/llm/chatModel'
import { AI_LLM_CALL_TIMEOUT_MS } from '../../../src/main/services/ai/constants'
import type { LlmRuntimeConfig } from '../../../src/shared/types'

const buildConfig = (input: Partial<LlmRuntimeConfig>): LlmRuntimeConfig => ({
  id: 'cfg',
  providerKind: 'openai-compatible',
  base_url: 'https://example.test/v1',
  model_name: 'test-model',
  api_key: 'test-key',
  is_active: true,
  ...input
})

describe('ai unit chat model provider registry', () => {
  it('allows responses fallback only for OpenAI provider configs', () => {
    expect(getSupportedTransportsForConfig(buildConfig({ providerKind: 'openai' }))).toEqual([
      'responses',
      'completions'
    ])
    expect(getSupportedTransportsForConfig(buildConfig({ providerKind: 'deepseek' }))).toEqual([
      'completions'
    ])
    expect(
      getSupportedTransportsForConfig(buildConfig({ providerKind: 'openai-compatible' }))
    ).toEqual(['completions'])
  })

  it('creates provider-specific chat model classes', () => {
    expect(createChatModel(buildConfig({ providerKind: 'openai' })).constructor.name).toBe(
      'ChatOpenAI'
    )
    expect(createChatModel(buildConfig({ providerKind: 'deepseek' })).constructor.name).toBe(
      'ChatDeepSeek'
    )
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
