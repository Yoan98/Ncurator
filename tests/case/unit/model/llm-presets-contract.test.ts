import { describe, expect, it } from 'vitest'
import {
  LLM_PRESET_PROVIDER_OPTIONS,
  emptyPresetModelsSnapshot,
  getPresetModel,
  getPresetProvider,
  getPresetProviderByBaseUrl,
  mergePresetCatalogProviders,
  resolvePresetModeProvider
} from '../../../../src/shared/llmPresets'
import { LLM_PROVIDER_REGISTRY } from '../../../../src/shared/llmProvider'

const buildConfig = (input: {
  name: string
  base_url: string
}): {
  providerKind: string
  name: string
  base_url: string
} => ({
  providerKind: 'openai-compatible',
  name: input.name,
  base_url: input.base_url
})

describe('shared llm presets catalog', () => {
  it('exposes preset provider options from local registry without model seeds', () => {
    expect(LLM_PRESET_PROVIDER_OPTIONS.length).toBeGreaterThan(0)
    for (const provider of LLM_PRESET_PROVIDER_OPTIONS) {
      const registry = LLM_PROVIDER_REGISTRY.find((item) => item.id === provider.providerId)
      expect(registry, `${provider.providerId} 应存在于服务商注册表`).toBeDefined()
      expect(provider.label, `${provider.providerId} 应有展示名`).not.toBe('')
      expect(provider).not.toHaveProperty('models')
    }
    expect(emptyPresetModelsSnapshot().providers).toEqual([])
  })

  it('resolves preset providers from official base urls', () => {
    expect(getPresetProviderByBaseUrl('https://api.deepseek.com')?.providerId).toBe('deepseek')
    expect(
      getPresetProviderByBaseUrl('https://dashscope.aliyuncs.com/compatible-mode/v1')?.providerId
    ).toBe('dashscope')
    expect(getPresetProviderByBaseUrl('https://api.xiaomimimo.com/v1')?.providerId).toBe('mimo')
    expect(getPresetProviderByBaseUrl('https://api.moonshot.cn/v1')?.providerId).toBe('moonshot')
    expect(getPresetProviderByBaseUrl('https://open.bigmodel.cn/api/paas/v4')?.providerId).toBe(
      'zhipu'
    )
  })

  it('looks up preset provider meta without hardcoded models', () => {
    const deepseek = getPresetProvider('deepseek')
    expect(deepseek).toEqual({ providerId: 'deepseek', label: 'DeepSeek' })
    expect(
      getPresetModel(
        {
          models: [
            {
              id: 'deepseek-flash',
              label: 'DeepSeek V4.1 Flash',
              iconUrl: 'https://www.guanzhangai.cn/llm/deepseek.png',
              priceTier: 'low',
              description: '',
              capabilities: ['text', 'vision']
            }
          ]
        },
        'deepseek-flash'
      )?.priceTier
    ).toBe('low')
  })

  it('merges remote catalog models with local provider labels', () => {
    const merged = mergePresetCatalogProviders([
      {
        providerId: 'deepseek',
        models: [
          {
            id: 'deepseek-flash',
            label: 'DeepSeek V4.1 Flash',
            iconUrl: 'https://www.guanzhangai.cn/llm/deepseek.png',
            priceTier: 'low',
            description: 'native multimodal',
            capabilities: ['text', 'vision']
          }
        ]
      }
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0].label).toBe('DeepSeek')
    expect(merged[0].models[0].id).toBe('deepseek-flash')
    expect(merged[0].models[0].iconUrl).toBe('https://www.guanzhangai.cn/llm/deepseek.png')
  })

  it('skips remote catalog models without iconUrl', () => {
    const merged = mergePresetCatalogProviders([
      {
        providerId: 'deepseek',
        models: [
          {
            id: 'missing-icon',
            label: 'Missing Icon',
            iconUrl: '   ',
            priceTier: 'low',
            description: '',
            capabilities: ['text']
          }
        ]
      }
    ])
    expect(merged).toEqual([])
  })
})

describe('shared llm presets mode derivation', () => {
  it('classifies preset mode when host matches and name equals provider label', () => {
    expect(
      resolvePresetModeProvider(
        buildConfig({ name: 'DeepSeek', base_url: 'https://api.deepseek.com' })
      )?.providerId
    ).toBe('deepseek')
    expect(
      resolvePresetModeProvider(
        buildConfig({ name: 'Kimi', base_url: 'https://api.moonshot.cn/v1' })
      )?.providerId
    ).toBe('moonshot')
  })

  it('classifies custom mode when name differs from the provider label', () => {
    expect(
      resolvePresetModeProvider(
        buildConfig({ name: '我的 DeepSeek', base_url: 'https://api.deepseek.com' })
      )
    ).toBeNull()
    expect(
      resolvePresetModeProvider(
        buildConfig({ name: 'DeepSeek 配置', base_url: 'https://api.deepseek.com/v1' })
      )
    ).toBeNull()
  })

  it('classifies custom mode for unknown or removed providers', () => {
    expect(
      resolvePresetModeProvider(
        buildConfig({ name: '公司 OpenAI', base_url: 'https://api.openai.com/v1' })
      )
    ).toBeNull()
    expect(
      resolvePresetModeProvider(
        buildConfig({ name: '豆包', base_url: 'https://ark.cn-beijing.volces.com/api/v3' })
      )
    ).toBeNull()
    expect(
      resolvePresetModeProvider(
        buildConfig({ name: '本地', base_url: 'http://localhost:11434/v1' })
      )
    ).toBeNull()
  })

  it('tolerates trailing slashes and case in base urls', () => {
    expect(
      resolvePresetModeProvider(
        buildConfig({ name: 'DeepSeek', base_url: 'https://api.deepseek.com/' })
      )?.providerId
    ).toBe('deepseek')
    expect(
      resolvePresetModeProvider(
        buildConfig({ name: 'Kimi', base_url: 'https://API.MOONSHOT.CN/v1/' })
      )?.providerId
    ).toBe('moonshot')
  })
})
