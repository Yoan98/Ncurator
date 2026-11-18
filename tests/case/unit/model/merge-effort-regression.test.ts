import { describe, expect, it } from 'vitest'
import { parseEffort } from '../../../../src/shared/llmEffort'
import { mergePresetCatalogProviders, getPresetModel } from '../../../../src/shared/llmPresets'

/**
 * mergePresetCatalogProviders 曾经逐字段重建模型对象，漏掉了 effort。
 * 表现：后端下发了档位、解析层也读到了，但合并后消失，
 * 于是「馆长模型有强度、自定义模型全都没有」，缓存里也查不到 effort。
 */
describe('merge keeps effort', () => {
  const P = ['low', 'mid', 'high'] as const
  const parseModel = (row: Record<string, unknown>) => {
    const id = String(row.id || row.modelName || '').trim()
    const label = String(row.label || '').trim()
    const iconUrl = String(row.iconUrl || '').trim()
    const priceTier = row.priceTier
    if (!id || !label || !iconUrl) return null
    if (!P.includes(priceTier as (typeof P)[number])) return null
    const capabilities = Array.isArray(row.capabilities)
      ? row.capabilities.filter((i: unknown) => i === 'text' || i === 'vision')
      : []
    if (capabilities.length === 0) return null
    const effort = parseEffort(row.effort)
    return {
      id,
      label,
      iconUrl,
      priceTier,
      description: '',
      capabilities,
      contextWindowTokens: 128000,
      ...(effort && { effort })
    }
  }

  it('does not drop effort when merging remote providers', () => {
    // 结构照抄生产目录 /api/v1/model-catalog 的 custom 行。
    const raw = {
      models: [
        {
          kind: 'custom',
          modelName: 'deepseek-flash',
          providerKey: 'deepseek',
          label: 'DeepSeek V4.1 Flash',
          iconUrl: 'https://www.guanzhangai.cn/llm/deepseek.png',
          priceTier: 'low',
          capabilities: ['text', 'vision'],
          effort: {
            default: 'high',
            options: [
              { value: 'low', label: '低' },
              { value: 'high', label: '高' },
              { value: 'max', label: '极高' }
            ]
          }
        },
        {
          kind: 'custom',
          modelName: 'qwen3.8-max',
          providerKey: 'dashscope',
          label: 'Qwen3.8 Max',
          iconUrl: 'https://www.guanzhangai.cn/llm/qwen.png',
          priceTier: 'high',
          capabilities: ['text', 'vision'],
          effort: {
            default: 'xhigh',
            options: [
              { value: 'low', label: '低' },
              { value: 'medium', label: '中' },
              { value: 'xhigh', label: '极高' }
            ]
          }
        }
      ]
    }
    const byProvider = new Map<string, { providerId: string; models: unknown[] }>()
    for (const row of raw.models) {
      if (row.kind !== 'custom' || typeof row.providerKey !== 'string') continue
      const model = parseModel({ ...row, id: row.modelName })
      if (!model) continue
      const entry = byProvider.get(row.providerKey)
      if (entry) entry.models.push(model)
      else byProvider.set(row.providerKey, { providerId: row.providerKey, models: [model] })
    }

    const merged = mergePresetCatalogProviders([...byProvider.values()] as never)
    const lines: string[] = []
    for (const provider of merged) {
      for (const model of provider.models) {
        lines.push(
          `${provider.providerId}/${model.id} => ${
            model.effort ? model.effort.options.map((o) => o.value).join('|') : 'NO TIERS'
          }`
        )
      }
    }
    console.log('merge 后:\n' + lines.map((l) => '  ' + l).join('\n'))

    // 关键断言：生产上配了档位的模型，合并后必须仍有 effort。
    const deepseek = merged
      .find((p) => p.providerId === 'deepseek')
      ?.models.find((m) => m.id === 'deepseek-flash')
    expect(deepseek?.effort?.options.map((o) => o.value)).toEqual(['low', 'high', 'max'])
    expect(deepseek?.effort?.default).toBe('high')

    // getPresetModel 是选择器真正走的路径，必须也能取到。
    const provider = merged.find((p) => p.providerId === 'deepseek')!
    expect(getPresetModel(provider, 'deepseek-flash')?.effort).toBeDefined()
  })

  it('keeps models without effort untouched', () => {
    const merged = mergePresetCatalogProviders([
      {
        providerId: 'mimo',
        models: [
          {
            id: 'mimo-v2.6-pro',
            label: 'MiMo Pro',
            iconUrl: 'https://x/y.png',
            priceTier: 'mid',
            description: '',
            capabilities: ['text']
          }
        ]
      }
    ] as never)
    expect(merged[0].models[0].effort).toBeUndefined()
  })
})
