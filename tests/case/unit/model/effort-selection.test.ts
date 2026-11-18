import { describe, expect, it } from 'vitest'
import { parseEffort, resolveEffort } from '../../../../src/shared/llmEffort'
import {
  findSelectionEffort,
  normalizeSelectionEffort,
  resolveSelectedWorkbenchModel
} from '../../../../src/shared/workbenchModelSelection'
import type { LLMConfig } from '../../../../src/shared/types'
import type { LlmPresetProvider } from '../../../../src/shared/llmPresets'

const effort = {
  default: 'high',
  options: [
    { value: 'none', label: '关闭思考' },
    { value: 'low', label: '轻量' },
    { value: 'high', label: '高' },
    { value: 'max', label: '极致' }
  ]
}

const presetConfig = (id: string): LLMConfig => ({
  id,
  name: 'DeepSeek',
  base_url: 'https://api.deepseek.com',
  api_key: 'sk-test',
  providerKind: 'deepseek'
})

const catalog: LlmPresetProvider[] = [
  {
    providerId: 'deepseek',
    label: 'DeepSeek',
    models: [
      {
        id: 'deepseek-flash',
        label: 'DeepSeek V4.1 Flash',
        iconUrl: 'https://www.guanzhangai.cn/llm/deepseek.png',
        priceTier: 'low',
        description: '',
        capabilities: ['text'],
        effort
      },
      {
        id: 'deepseek-plain',
        label: 'DeepSeek Plain',
        iconUrl: 'https://www.guanzhangai.cn/llm/deepseek.png',
        priceTier: 'low',
        description: '',
        capabilities: ['text']
      }
    ]
  }
]

describe('parseEffort', () => {
  it('keeps the catalog order and wording', () => {
    expect(parseEffort(effort)).toEqual(effort)
  })

  it('drops only this model when the payload is malformed', () => {
    expect(parseEffort(undefined)).toBeUndefined()
    expect(parseEffort({ ...effort, default: 'medium' })).toBeUndefined()
    expect(parseEffort({ ...effort, options: [...effort.options, { value: 'max', label: '重复' }] })).toBeUndefined()
    // 空 label 不算坏配置：退回 value 当文案，而不是丢掉整个档位能力。
    expect(parseEffort({ default: 'low', options: [{ value: 'low', label: '' }] })).toEqual({
      default: 'low',
      options: [{ value: 'low', label: 'low' }]
    })
    expect(parseEffort({ default: 'low', options: [] })).toBeUndefined()
  })
})

describe('resolveEffort', () => {
  it('falls back to the catalog default instead of sending an unsupported tier', () => {
    expect(resolveEffort(effort, 'max')).toBe('max')
    expect(resolveEffort(effort, 'medium')).toBe('high')
    expect(resolveEffort(effort, undefined)).toBe('high')
    expect(resolveEffort(undefined, 'max')).toBeUndefined()
  })
})

describe('normalizeSelectionEffort', () => {
  it('writes the default tier into the snapshot when the model opens a switch', () => {
    expect(normalizeSelectionEffort({ configId: 'c', modelName: 'm' }, effort))
      .toEqual({ configId: 'c', modelName: 'm', effort: 'high' })
  })

  it('keeps a still-valid tier and drops it when the model closes the switch', () => {
    expect(normalizeSelectionEffort({ configId: 'c', modelName: 'm', effort: 'max' }, effort))
      .toEqual({ configId: 'c', modelName: 'm', effort: 'max' })
    // 模型确实不支持档位（目录给了空选项）时才清掉。
    expect(normalizeSelectionEffort({ configId: 'c', modelName: 'm', effort: 'max' }, { default: 'low', options: [] }))
      .toEqual({ configId: 'c', modelName: 'm', effort: 'low' })
    expect(normalizeSelectionEffort(null, effort)).toBeNull()
  })

  it('keeps the chosen tier when the model tiers are not known yet', () => {
    // 目录未加载 / 切换伙伴的瞬间会传 undefined：这不是「不支持档位」，不能清掉用户的选择。
    expect(normalizeSelectionEffort({ configId: 'c', modelName: 'm', effort: 'max' }, undefined))
      .toEqual({ configId: 'c', modelName: 'm', effort: 'max' })
    // manual 与普通选择都要保留。
    expect(normalizeSelectionEffort({ configId: 'c', modelName: 'm', effort: 'xhigh', manual: true }, undefined))
      .toEqual({ configId: 'c', modelName: 'm', effort: 'xhigh', manual: true })
    // 引用相等：调用方靠它判断「没变化就不回写」，避免无谓的持久化。
    const selection = { configId: 'c', modelName: 'm', effort: 'max' as const }
    expect(normalizeSelectionEffort(selection, undefined)).toBe(selection)
  })

  it('preserves the manual flag so a typed model name keeps its identity', () => {
    expect(normalizeSelectionEffort({ configId: 'c', modelName: 'm', manual: true }, effort))
      .toEqual({ configId: 'c', modelName: 'm', manual: true, effort: 'high' })
  })
})

describe('findSelectionEffort', () => {
  const configs = [presetConfig('deepseek-config')]

  it('reads the switch of the currently selected preset model', () => {
    expect(findSelectionEffort({
      selected: { configId: 'deepseek-config', modelName: 'deepseek-flash' },
      configs,
      presetProviders: catalog
    })).toEqual(effort)
  })

  it('returns nothing for models without a configured switch', () => {
    expect(findSelectionEffort({
      selected: { configId: 'deepseek-config', modelName: 'deepseek-plain' },
      configs,
      presetProviders: catalog
    })).toBeUndefined()
    expect(findSelectionEffort({ selected: null, configs, presetProviders: catalog })).toBeUndefined()
  })

  it('reads the switch of the selected managed entry', () => {
    expect(findSelectionEffort({
      selected: { configId: 'managed:42', modelName: 'DeepSeek V4.1 Flash' },
      configs,
      managedEfforts: [{ id: '42', effort }]
    })).toEqual(effort)
    expect(findSelectionEffort({
      selected: { configId: 'managed:43', modelName: 'x' },
      configs,
      managedEfforts: [{ id: '42', effort }]
    })).toBeUndefined()
  })

  it('never offers a switch for free models', () => {
    expect(findSelectionEffort({
      selected: { configId: 'free:7', modelName: 'glm-4-flash-250414' },
      configs,
      presetProviders: catalog
    })).toBeUndefined()
  })
})

describe('resolveSelectedWorkbenchModel', () => {
  const configs = [presetConfig('deepseek-config')]
  const remote = { 'deepseek-config': [{ id: 'deepseek-flash', label: 'DeepSeek V4.1 Flash' }] }

  it('keeps the tier when the identity still resolves', () => {
    // 该函数重建返回对象；丢掉 effort 会让重启、目录刷新和恢复快照后档位归零。
    for (const selected of [
      { configId: 'deepseek-config', modelName: 'deepseek-flash', effort: 'max' },
      { configId: 'deepseek-config', modelName: 'deepseek-flash', manual: true as const, effort: 'low' }
    ]) {
      expect(resolveSelectedWorkbenchModel({ configs, modelListsByConfigId: remote, selected, presetProviders: catalog }))
        .toMatchObject({ effort: selected.effort })
    }
  })

  it('keeps the tier for managed entries and while the preset catalog is missing', () => {
    expect(resolveSelectedWorkbenchModel({
      configs, modelListsByConfigId: {},
      selected: { configId: 'managed:42', modelName: 'DeepSeek V4.1 Flash', effort: 'max' }
    })).toEqual({ configId: 'managed:42', modelName: 'DeepSeek V4.1 Flash', effort: 'max' })
    expect(resolveSelectedWorkbenchModel({
      configs, modelListsByConfigId: {},
      selected: { configId: 'deepseek-config', modelName: 'deepseek-flash', effort: 'low' }
    })).toEqual({ configId: 'deepseek-config', modelName: 'deepseek-flash', effort: 'low' })
  })

  it('drops the tier when the identity itself no longer resolves', () => {
    expect(resolveSelectedWorkbenchModel({
      configs, modelListsByConfigId: remote, presetProviders: catalog,
      selected: { configId: 'deepseek-config', modelName: 'gone-model', effort: 'max' }
    })).toBeNull()
  })

  it('never carries a tier onto a free model', () => {
    const freeModels = [{
      configId: 'free:7', modelName: 'glm-4-flash-250414', label: 'GLM', iconUrl: 'https://x/y.png',
      capabilities: ['text'] as ('text' | 'vision')[], priceTier: 'low' as const, legacy: null, pricing: null
    } as never]
    expect(resolveSelectedWorkbenchModel({
      configs, modelListsByConfigId: remote, freeModels,
      selected: { configId: 'free:7', modelName: 'glm-4-flash-250414', effort: 'max' }
    })).toEqual({ configId: 'free:7', modelName: 'glm-4-flash-250414' })
  })
})
