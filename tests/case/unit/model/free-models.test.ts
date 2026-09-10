import { describe, expect, it } from 'vitest'
import {
  isFreeModelConfigId,
  toFreeModelConfigId,
  toFreeModelPublicEntry,
  type FreeModelCatalogEntry
} from '../../../../src/shared/freeModels'

const sampleEntry = (overrides?: Partial<FreeModelCatalogEntry>): FreeModelCatalogEntry => ({
  id: 'free-deepseek-v4-flash',
  providerKind: 'openai-compatible',
  modelName: 'deepseek-ai/deepseek-v4-flash-0731',
  label: 'DeepSeek V4 Flash',
  description: '更快更省，适合日常问答与轻量任务。',
  capabilities: ['text'],
  iconUrl: 'https://www.guanzhangai.cn/llm/deepseek.png',
  baseUrl: 'https://integrate.api.nvidia.com/v1',
  apiKey: 'nvapi-test',
  ...overrides
})

describe('free model catalog helpers', () => {
  it('builds synthetic config ids and strips secrets for renderer', () => {
    const entry = sampleEntry()
    expect(toFreeModelConfigId(entry.id)).toBe('free:free-deepseek-v4-flash')
    expect(isFreeModelConfigId('free:free-deepseek-v4-flash')).toBe(true)
    expect(isFreeModelConfigId('user-config')).toBe(false)

    const publicEntry = toFreeModelPublicEntry(entry)
    expect(publicEntry.configId).toBe('free:free-deepseek-v4-flash')
    expect(publicEntry).not.toHaveProperty('apiKey')
    expect(publicEntry).not.toHaveProperty('providerId')
    expect(publicEntry.iconUrl).toBe(entry.iconUrl)
  })
})
