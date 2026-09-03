import { describe, expect, it } from 'vitest'
import {
  pickFallbackWorkbenchModel,
  resolveSelectedWorkbenchModel,
  isPresetModelAvailableInRemoteList
} from '../../../../src/shared/workbenchModelSelection'
import type { LLMConfig, LlmRemoteModel } from '../../../../src/shared/types'

const presetConfig = (id: string): LLMConfig => ({
  id,
  name: '通义千问',
  base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  api_key: 'sk-test',
  providerKind: 'openai-compatible'
})

const customConfig = (id: string): LLMConfig => ({
  id,
  name: '我的通义',
  base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  api_key: 'sk-test',
  providerKind: 'openai-compatible'
})

const remote = (...ids: string[]): LlmRemoteModel[] =>
  ids.map((id) => ({ id, label: id }))

describe('workbench model selection', () => {
  it('requires exact remote id for preset availability when list is non-empty', () => {
    expect(isPresetModelAvailableInRemoteList('qwen3.8-max', remote('qwen3.8-max'))).toBe(true)
    expect(
      isPresetModelAvailableInRemoteList('qwen3.8-max', remote('qwen3.8-max-0902'))
    ).toBe(false)
    expect(isPresetModelAvailableInRemoteList('qwen3.8-max', [])).toBe(true)
  })

  it('rejects dated remote ids as selected preset models', () => {
    const configs = [presetConfig('cfg-1')]
    const lists = { 'cfg-1': remote('qwen3.8-max-0902', 'qwen3.8-max') }
    expect(
      resolveSelectedWorkbenchModel({
        configs,
        modelListsByConfigId: lists,
        selected: { configId: 'cfg-1', modelName: 'qwen3.8-max-0902' }
      })
    ).toBeNull()
    expect(
      resolveSelectedWorkbenchModel({
        configs,
        modelListsByConfigId: lists,
        selected: { configId: 'cfg-1', modelName: 'qwen3.8-max' }
      })
    ).toEqual({ configId: 'cfg-1', modelName: 'qwen3.8-max' })
  })

  it('falls back to the first available preset id instead of the first remote id', () => {
    const configs = [presetConfig('cfg-1')]
    const lists = {
      'cfg-1': remote('qwen3.8-max-0902', 'qwen3.7-text-embedding-flash', 'qwen3.8-max')
    }
    expect(
      pickFallbackWorkbenchModel({
        configs,
        modelListsByConfigId: lists
      })
    ).toEqual({ configId: 'cfg-1', modelName: 'qwen3.8-max' })
  })

  it('skips unavailable presets and uses the next available preset model', () => {
    const configs = [presetConfig('cfg-1')]
    const lists = {
      'cfg-1': remote('qwen3.8-flash', 'qwen3.8-max-0902')
    }
    expect(
      pickFallbackWorkbenchModel({
        configs,
        modelListsByConfigId: lists
      })
    ).toEqual({ configId: 'cfg-1', modelName: 'qwen3.8-flash' })
  })

  it('uses custom remote chat models only when no preset config is available', () => {
    const configs = [customConfig('cfg-custom')]
    const lists = {
      'cfg-custom': remote('qwen3.8-max-0902', 'qwen3.7-text-embedding-flash')
    }
    expect(
      pickFallbackWorkbenchModel({
        configs,
        modelListsByConfigId: lists
      })
    ).toEqual({ configId: 'cfg-custom', modelName: 'qwen3.8-max-0902' })
  })
})
