import { describe, expect, it } from 'vitest'
import { resolveOpenAICompatibleRuntimeOptions } from '../../../../src/main/services/llm/openaiCompatible'
import type { LlmRuntimeConfig } from '../../../../src/shared/types'

const createConfig = (overrides?: Partial<LlmRuntimeConfig>): LlmRuntimeConfig => ({
  id: 'cfg-openai-compatible',
  name: 'OpenAI Compatible Config',
  providerKind: 'openai-compatible',
  base_url: 'https://gateway.example.com/chat/completions',
  api_key: 'test-key',
  model_name: 'custom-model',
  ...overrides
})

describe('openai compatible runtime options', () => {
  it('normalizes the base url and preserves the configured model name', () => {
    const result = resolveOpenAICompatibleRuntimeOptions(createConfig(), {
      consumerName: 'browser_use'
    })

    expect(result).toEqual({
      providerKind: 'openai-compatible',
      modelName: 'custom-model',
      baseURL: 'https://gateway.example.com/v1',
      apiKey: 'test-key'
    })
  })

  it('keeps the explicitly stored provider kind for official base urls', () => {
    expect(
      resolveOpenAICompatibleRuntimeOptions(
        createConfig({
          providerKind: 'openai-compatible',
          base_url: 'https://api.openai.com',
          model_name: 'gpt-4.1-mini'
        }),
        { consumerName: 'browser_use' }
      ).providerKind
    ).toBe('openai-compatible')

    expect(
      resolveOpenAICompatibleRuntimeOptions(
        createConfig({
          providerKind: 'openai-compatible',
          base_url: 'https://api.deepseek.com',
          model_name: 'deepseek-chat'
        }),
        { consumerName: 'browser_use' }
      ).providerKind
    ).toBe('openai-compatible')
  })

  it('keeps an explicitly stored provider kind for custom endpoints', () => {
    expect(
      resolveOpenAICompatibleRuntimeOptions(
        createConfig({
          providerKind: 'deepseek',
          base_url: 'https://gateway.example.com/v1'
        }),
        { consumerName: 'browser_use' }
      ).providerKind
    ).toBe('deepseek')
  })
})
