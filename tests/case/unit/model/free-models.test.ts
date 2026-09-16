import { describe, expect, it } from 'vitest'
import {
  isFreeModelConfigId,
  toFreeModelConfigId,
  toFreeModelPublicEntry,
  type FreeModelCatalogEntry
} from '../../../../src/shared/freeModels'

const sampleEntry = (overrides?: Partial<FreeModelCatalogEntry>): FreeModelCatalogEntry => ({
  id: 'free-glm-4.7-flash',
  providerKind: 'openai-compatible',
  modelName: 'glm-4.7-flash',
  label: 'GLM-4.7 Flash',
  description: '智谱免费主力：更强工具协同与长任务，高峰可能排队。',
  capabilities: ['text'],
  iconUrl: 'https://www.guanzhangai.cn/llm/zhipu.png',
  baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
  apiKey: 'zhipu-test',
  ...overrides
})

describe('free model catalog helpers', () => {
  it('builds synthetic config ids and strips secrets for renderer', () => {
    const entry = sampleEntry()
    expect(toFreeModelConfigId(entry.id)).toBe('free:free-glm-4.7-flash')
    expect(isFreeModelConfigId('free:free-glm-4.7-flash')).toBe(true)
    expect(isFreeModelConfigId('user-config')).toBe(false)

    const publicEntry = toFreeModelPublicEntry(entry)
    expect(publicEntry.configId).toBe('free:free-glm-4.7-flash')
    expect(publicEntry).not.toHaveProperty('apiKey')
    expect(publicEntry).not.toHaveProperty('providerId')
    expect(publicEntry.iconUrl).toBe(entry.iconUrl)
  })
})
