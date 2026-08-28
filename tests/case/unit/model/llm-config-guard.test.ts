import { describe, expect, it } from 'vitest'
import { validateLlmConfigForSave } from '../../../../src/main/services/llm/configGuard'
import type { LLMConfig } from '../../../../src/shared/types'
import type { LlmConfigStore } from '../../../../src/main/services/storage/domains/LlmConfigStore'

const buildConfig = (input: Partial<LLMConfig>): LLMConfig => ({
  id: 'cfg-1',
  name: 'DeepSeek',
  providerKind: 'openai-compatible',
  base_url: 'https://api.deepseek.com',
  api_key: 'sk-test',
  ...input
})

const createStore = (existing: LLMConfig[]): LlmConfigStore =>
  ({
    list: async () => existing,
    save: async () => {},
    delete: async () => {},
    getById: async () => null
  }) as unknown as LlmConfigStore

describe('main llm config guard', () => {
  it('pins base url and provider kind while keeping the provided name', async () => {
    const store = createStore([])
    const check = await validateLlmConfigForSave(
      store,
      buildConfig({ id: 'cfg-new', api_key: 'sk-new' })
    )
    expect(check.ok).toBe(true)
    if (!check.ok) return
    expect(check.config.name).toBe('DeepSeek')
    expect(check.config.base_url).toBe('https://api.deepseek.com')
    expect(check.config.providerKind).toBe('deepseek')
  })

  it('rejects a second preset config for the same provider', async () => {
    const store = createStore([
      buildConfig({ id: 'cfg-existing', api_key: 'sk-existing' })
    ])
    const check = await validateLlmConfigForSave(store, buildConfig({ id: 'cfg-new' }))
    expect(check.ok).toBe(false)
    if (check.ok) return
    expect(check.error).toContain('只允许一条')
  })

  it('allows editing the same preset config (id match) and keeps it unique', async () => {
    const store = createStore([buildConfig({ id: 'cfg-existing', api_key: 'sk-old' })])
    const check = await validateLlmConfigForSave(
      store,
      buildConfig({ id: 'cfg-existing', api_key: 'sk-new' })
    )
    expect(check.ok).toBe(true)
  })

  it('pins preset base url and provider kind even with a custom path', async () => {
    const store = createStore([])
    const check = await validateLlmConfigForSave(
      store,
      buildConfig({ name: 'DeepSeek', base_url: 'https://api.deepseek.com/custom-path' })
    )
    expect(check.ok).toBe(true)
    if (!check.ok) return
    expect(check.config.base_url).toBe('https://api.deepseek.com')
    expect(check.config.providerKind).toBe('deepseek')
  })

  it('keeps a custom name for preset configs and pins base url and kind', async () => {
    const store = createStore([])
    const check = await validateLlmConfigForSave(
      store,
      buildConfig({ id: 'cfg-new', name: 'DeepSeek 改过', base_url: 'https://api.deepseek.com' })
    )
    expect(check.ok).toBe(true)
    if (!check.ok) return
    expect(check.config.name).toBe('DeepSeek 改过')
    expect(check.config.base_url).toBe('https://api.deepseek.com')
    expect(check.config.providerKind).toBe('deepseek')
  })

  it('classifies by base url even when name belongs to another provider', async () => {
    const store = createStore([])
    const check = await validateLlmConfigForSave(
      store,
      buildConfig({ id: 'cfg-new', name: 'Kimi', base_url: 'https://api.deepseek.com' })
    )
    expect(check.ok).toBe(true)
    if (!check.ok) return
    expect(check.config.base_url).toBe('https://api.deepseek.com')
    expect(check.config.providerKind).toBe('deepseek')
  })

  it('rejects custom configs with a duplicated name', async () => {
    const store = createStore([buildConfig({ name: '公司模型', base_url: 'https://a.test/v1' })])
    const check = await validateLlmConfigForSave(
      store,
      buildConfig({ id: 'cfg-new', name: '公司模型', base_url: 'https://b.test/v1' })
    )
    expect(check.ok).toBe(false)
    if (check.ok) return
    expect(check.error).toContain('不能重复')
  })

  it('allows custom configs with unique names and keeps original fields', async () => {
    const store = createStore([])
    const check = await validateLlmConfigForSave(
      store,
      buildConfig({ name: '公司模型', base_url: 'https://a.test/v1', api_key: 'sk-a' })
    )
    expect(check.ok).toBe(true)
    if (!check.ok) return
    expect(check.config.base_url).toBe('https://a.test/v1')
    expect(check.config.name).toBe('公司模型')
  })
})