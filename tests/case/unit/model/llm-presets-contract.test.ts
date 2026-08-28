import { describe, expect, it } from 'vitest'
import {
  LLM_PRESET_PROVIDERS,
  getPresetModel,
  getPresetProvider,
  getPresetProviderByBaseUrl,
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
  it('keeps every preset provider registered with models and price tiers', () => {
    for (const provider of LLM_PRESET_PROVIDERS) {
      const registry = LLM_PROVIDER_REGISTRY.find((item) => item.id === provider.providerId)
      expect(registry, `${provider.providerId} 应存在于服务商注册表`).toBeDefined()
      expect(provider.label, `${provider.providerId} 应有展示名`).not.toBe('')
      expect(provider.models.length, `${provider.providerId} 应有推荐模型`).toBeGreaterThan(0)
      expect(provider.checkedAt, `${provider.providerId} 应有核对日期`).toMatch(
        /^\d{4}-\d{2}-\d{2}$/
      )
      expect(provider.sourceUrl, `${provider.providerId} 应有官方来源链接`).toMatch(/^https?:\/\//)

      const modelIds = new Set<string>()
      for (const model of provider.models) {
        expect(model.id.trim(), '模型 ID 不能为空').not.toBe('')
        expect(modelIds.has(model.id), `${provider.providerId} 模型 ID 重复: ${model.id}`).toBe(
          false
        )
        modelIds.add(model.id)
        expect(['low', 'mid', 'high']).toContain(model.priceTier)
      }
    }
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

  it('looks up preset models by id', () => {
    const deepseek = getPresetProvider('deepseek')
    expect(deepseek).not.toBeNull()
    expect(getPresetModel(deepseek!, 'deepseek-v4-flash')?.priceTier).toBe('low')
    expect(getPresetModel(deepseek!, 'deepseek-v4-pro')?.priceTier).toBe('mid')
    expect(getPresetModel(deepseek!, 'unknown-model')).toBeNull()
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
