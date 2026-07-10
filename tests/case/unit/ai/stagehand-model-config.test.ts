import { describe, expect, it } from 'vitest'
import { resolveStagehandModelConfig } from '../../../../src/main/services/llm/stagehandModel'
import type { LlmRuntimeConfig } from '../../../../src/shared/types'

const createConfig = (overrides?: Partial<LlmRuntimeConfig>): LlmRuntimeConfig => ({
  id: 'cfg-stagehand',
  name: 'Stagehand Config',
  providerKind: 'openai-compatible',
  base_url: 'https://gateway.example.com/chat/completions',
  api_key: 'test-key',
  is_active: true,
  default_model: 'unused-default-model',
  model_name: 'custom-browser-model',
  ...overrides
})

describe('stagehand model config', () => {
  it('maps openai-compatible configs onto the openai provider and keeps the custom base url', () => {
    const result = resolveStagehandModelConfig(createConfig())

    expect(result.providerKind).toBe('openai-compatible')
    expect(result.provider).toBe('openai')
    expect(result.model).toEqual({
      modelName: 'openai/custom-browser-model',
      apiKey: 'test-key',
      baseURL: 'https://gateway.example.com/v1'
    })
  })

  it('uses the deepseek Stagehand provider for openai-compatible deepseek models', () => {
    const result = resolveStagehandModelConfig(
      createConfig({
        model_name: 'deepseek-v4-flash'
      })
    )

    expect(result.providerKind).toBe('openai-compatible')
    expect(result.provider).toBe('deepseek')
    expect(result.model).toEqual({
      modelName: 'deepseek/deepseek-v4-flash',
      apiKey: 'test-key',
      baseURL: 'https://gateway.example.com/v1'
    })
  })

  it('maps deepseek configs onto the deepseek provider without restricting custom model names', () => {
    const result = resolveStagehandModelConfig(
      createConfig({
        providerKind: 'deepseek',
        base_url: 'https://api.deepseek.com',
        model_name: 'deepseek-chat-vNext'
      })
    )

    expect(result.providerKind).toBe('deepseek')
    expect(result.provider).toBe('deepseek')
    expect(result.model).toEqual({
      modelName: 'deepseek/deepseek-chat-vNext',
      apiKey: 'test-key',
      baseURL: 'https://api.deepseek.com/v1'
    })
  })

  it('accepts model names outside Stagehand built-in model aliases', () => {
    const result = resolveStagehandModelConfig(
      createConfig({
        providerKind: 'openai',
        model_name: 'my-team/custom-stagehand-model'
      })
    )

    expect(result.model.modelName).toBe('openai/my-team/custom-stagehand-model')
  })

  it('rejects unsupported provider kinds before Stagehand runs', () => {
    expect(() =>
      resolveStagehandModelConfig(
        createConfig({
          providerKind: 'anthropic' as LlmRuntimeConfig['providerKind']
        })
      )
    ).toThrowError('browser_use only supports OpenAI-style providers: received anthropic')
  })

  it('rejects empty required connection fields with clear diagnostics', () => {
    expect(() =>
      resolveStagehandModelConfig(
        createConfig({
          model_name: '   '
        })
      )
    ).toThrowError('browser_use requires a non-empty model_name')

    expect(() =>
      resolveStagehandModelConfig(
        createConfig({
          base_url: '   '
        })
      )
    ).toThrowError('browser_use requires a non-empty base_url')

    expect(() =>
      resolveStagehandModelConfig(
        createConfig({
          api_key: '   '
        })
      )
    ).toThrowError('browser_use requires a non-empty api_key')
  })
})
