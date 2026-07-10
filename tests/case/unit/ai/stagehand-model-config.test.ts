import { describe, expect, it } from 'vitest'
import { resolveStagehandRuntimeModel } from '../../../../src/main/services/llm/stagehandModel'
import { StagehandLangChainClient } from '../../../../src/main/services/llm/stagehandLangChainClient'
import type { LlmRuntimeConfig } from '../../../../src/shared/types'

const createConfig = (overrides?: Partial<LlmRuntimeConfig>): LlmRuntimeConfig => ({
  id: 'cfg-stagehand',
  name: 'Stagehand Config',
  providerKind: 'openai-compatible',
  base_url: 'https://gateway.example.com/chat/completions',
  api_key: 'test-key',
  model_name: 'custom-browser-model',
  ...overrides
})

describe('stagehand model config', () => {
  it('uses a LangChain client for OpenAI-compatible custom endpoints', () => {
    const result = resolveStagehandRuntimeModel(createConfig())

    expect(result.mode).toBe('langchain-client')
    expect(result.provider).toBe('openai-compatible')
    if (result.mode !== 'langchain-client') throw new Error('expected langchain client')
    expect(result.llmClient).toBeInstanceOf(StagehandLangChainClient)
  })

  it('does not infer DeepSeek provider from custom endpoint model names', () => {
    const result = resolveStagehandRuntimeModel(
      createConfig({
        model_name: 'deepseek-v4-flash'
      })
    )

    expect(result.mode).toBe('langchain-client')
    expect(result.provider).toBe('openai-compatible')
  })

  it('maps official DeepSeek endpoint onto the DeepSeek Stagehand provider', () => {
    const result = resolveStagehandRuntimeModel(
      createConfig({
        providerKind: 'openai-compatible',
        base_url: 'https://api.deepseek.com',
        model_name: 'deepseek-chat-vNext'
      })
    )

    expect(result.mode).toBe('stagehand-model')
    expect(result.provider).toBe('deepseek')
    if (result.mode !== 'stagehand-model') throw new Error('expected stagehand model')
    expect(result.model).toEqual({
      modelName: 'deepseek/deepseek-chat-vNext',
      apiKey: 'test-key',
      baseURL: 'https://api.deepseek.com/v1'
    })
  })

  it('maps official OpenAI endpoint onto the OpenAI Stagehand provider', () => {
    const result = resolveStagehandRuntimeModel(
      createConfig({
        providerKind: 'openai-compatible',
        base_url: 'https://api.openai.com/v1',
        model_name: 'my-team/custom-stagehand-model'
      })
    )

    expect(result.mode).toBe('stagehand-model')
    expect(result.provider).toBe('openai')
    if (result.mode !== 'stagehand-model') throw new Error('expected stagehand model')
    expect(result.model.modelName).toBe('openai/my-team/custom-stagehand-model')
  })

  it('ignores stale stored providerKind and resolves provider from base_url', () => {
    const result = resolveStagehandRuntimeModel(
      createConfig({
        providerKind: 'deepseek',
        base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        model_name: 'deepseek-v4-flash'
      })
    )

    expect(result.mode).toBe('langchain-client')
    expect(result.provider).toBe('openai-compatible')
  })

  it('rejects empty required connection fields with clear diagnostics', () => {
    expect(() =>
      resolveStagehandRuntimeModel(
        createConfig({
          model_name: '   '
        })
      )
    ).toThrowError('browser_use requires a non-empty model_name')

    expect(() =>
      resolveStagehandRuntimeModel(
        createConfig({
          base_url: '   '
        })
      )
    ).toThrowError('browser_use requires a non-empty base_url')

    expect(() =>
      resolveStagehandRuntimeModel(
        createConfig({
          api_key: '   '
        })
      )
    ).toThrowError('browser_use requires a non-empty api_key')
  })
})
