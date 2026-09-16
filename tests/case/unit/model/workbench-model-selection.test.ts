import { describe, expect, it } from 'vitest'
import {
  pickFallbackWorkbenchModel,
  resolveSelectedWorkbenchModel,
  isPresetModelAvailableInRemoteList
} from '../../../../src/shared/workbenchModelSelection'
import type { LLMConfig, LlmRemoteModel } from '../../../../src/shared/types'
import { toFreeModelPublicEntry, type FreeModelCatalogEntry } from '../../../../src/shared/freeModels'
import type { LlmPresetProvider } from '../../../../src/shared/llmPresets'

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

const dashscopeCatalog: LlmPresetProvider[] = [
  {
    providerId: 'dashscope',
    label: '通义千问',
    models: [
      {
        id: 'qwen3.8-max',
        label: 'Qwen3.8 Max',
        iconUrl: 'https://www.guanzhangai.cn/llm/qwen.png',
        priceTier: 'high',
        description: '',
        capabilities: ['text', 'vision']
      },
      {
        id: 'qwen3.8-flash',
        label: 'Qwen3.8 Flash',
        iconUrl: 'https://www.guanzhangai.cn/llm/qwen.png',
        priceTier: 'low',
        description: '',
        capabilities: ['text', 'vision']
      }
    ]
  }
]

describe('workbench model selection', () => {
  it('requires exact remote id for preset availability when list is non-empty', () => {
    expect(isPresetModelAvailableInRemoteList('qwen3.8-max', remote('qwen3.8-max'))).toBe(true)
    expect(
      isPresetModelAvailableInRemoteList('qwen3.8-max', remote('qwen3.8-max-0902'))
    ).toBe(false)
    expect(isPresetModelAvailableInRemoteList('qwen3.8-max', [])).toBe(true)
  })

  it('keeps custom remote ids selected under a recommend config', () => {
    const configs = [presetConfig('cfg-1')]
    const lists = { 'cfg-1': remote('qwen3.8-max-0902', 'qwen3.8-max') }
    expect(
      resolveSelectedWorkbenchModel({
        configs,
        modelListsByConfigId: lists,
        selected: { configId: 'cfg-1', modelName: 'qwen3.8-max-0902' }
      })
    ).toEqual({ configId: 'cfg-1', modelName: 'qwen3.8-max-0902' })
    expect(
      resolveSelectedWorkbenchModel({
        configs,
        modelListsByConfigId: lists,
        selected: { configId: 'cfg-1', modelName: 'qwen3.8-max' }
      })
    ).toEqual({ configId: 'cfg-1', modelName: 'qwen3.8-max' })
  })

  it('rejects selected ids that are absent from a non-empty remote list', () => {
    const configs = [presetConfig('cfg-1')]
    const lists = { 'cfg-1': remote('qwen3.8-max') }
    expect(
      resolveSelectedWorkbenchModel({
        configs,
        modelListsByConfigId: lists,
        selected: { configId: 'cfg-1', modelName: 'missing-model' }
      })
    ).toBeNull()
  })

  it('keeps preset selection when remote list is empty and catalog is not loaded', () => {
    const configs = [presetConfig('cfg-1')]
    expect(
      resolveSelectedWorkbenchModel({
        configs,
        modelListsByConfigId: { 'cfg-1': [] },
        selected: { configId: 'cfg-1', modelName: 'qwen3.8-max-0902' }
      })
    ).toEqual({ configId: 'cfg-1', modelName: 'qwen3.8-max-0902' })
  })

  it('when catalog is loaded, empty remote only keeps ids present in catalog', () => {
    const configs = [presetConfig('cfg-1')]
    expect(
      resolveSelectedWorkbenchModel({
        configs,
        modelListsByConfigId: { 'cfg-1': [] },
        selected: { configId: 'cfg-1', modelName: 'qwen3.8-max' },
        presetProviders: dashscopeCatalog
      })
    ).toEqual({ configId: 'cfg-1', modelName: 'qwen3.8-max' })
    expect(
      resolveSelectedWorkbenchModel({
        configs,
        modelListsByConfigId: { 'cfg-1': [] },
        selected: { configId: 'cfg-1', modelName: 'qwen3.8-max-0902' },
        presetProviders: dashscopeCatalog
      })
    ).toBeNull()
  })

  it('falls back to the first available preset id instead of the first remote id', () => {
    const configs = [presetConfig('cfg-1')]
    const lists = {
      'cfg-1': remote('qwen3.8-max-0902', 'qwen3.7-text-embedding-flash', 'qwen3.8-max')
    }
    expect(
      pickFallbackWorkbenchModel({
        configs,
        modelListsByConfigId: lists,
        presetProviders: dashscopeCatalog
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
        modelListsByConfigId: lists,
        presetProviders: dashscopeCatalog
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
        modelListsByConfigId: lists,
        presetProviders: dashscopeCatalog
      })
    ).toEqual({ configId: 'cfg-custom', modelName: 'qwen3.8-max-0902' })
  })

  it('keeps free model selections and falls back to free catalog when no user configs', () => {
    const freeEntry: FreeModelCatalogEntry = {
      id: 'free-glm-4.7-flash',
      providerKind: 'openai-compatible',
      modelName: 'glm-4.7-flash',
      label: 'GLM-4.7 Flash',
      description: '智谱免费主力：更强工具协同与长任务，高峰可能排队。',
      capabilities: ['text'],
      iconUrl: 'https://www.guanzhangai.cn/llm/zhipu.png',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      apiKey: 'zhipu-test'
    }
    const freeModels = [toFreeModelPublicEntry(freeEntry)]
    expect(
      resolveSelectedWorkbenchModel({
        configs: [],
        modelListsByConfigId: {},
        selected: {
          configId: freeModels[0].configId,
          modelName: freeModels[0].modelName
        },
        freeModels
      })
    ).toEqual({
      configId: freeModels[0].configId,
      modelName: freeModels[0].modelName
    })

    expect(
      pickFallbackWorkbenchModel({
        configs: [],
        modelListsByConfigId: {},
        freeModels
      })
    ).toEqual({
      configId: freeModels[0].configId,
      modelName: freeModels[0].modelName
    })
  })
})
