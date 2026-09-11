import { describe, expect, it } from 'vitest'
import {
  LIVE_DEFAULT_PROVIDER,
  LIVE_PROVIDER_DEFAULT_MODEL,
  LIVE_PRESET_PROVIDER_IDS,
  listConfiguredLiveLlmTargets,
  liveKeyEnvName,
  resolveLiveLlmTarget
} from '../../../../tests/harness/core/liveProviders'
import { LLM_PROVIDER_REGISTRY } from '../../../../src/shared/llmProvider'

const clearLiveEnv = (): void => {
  delete process.env.AI_LIVE_PROVIDER
  delete process.env.AI_LIVE_MODEL
  for (const providerId of LIVE_PRESET_PROVIDER_IDS) {
    delete process.env[liveKeyEnvName(providerId)]
  }
  delete process.env.AI_LIVE_BASE_URL
  delete process.env.AI_LIVE_API_KEY
  delete process.env.AI_LIVE_PRIMARY_MODEL_NAME
}

describe('liveProviders harness', () => {
  it('defaults to dashscope + qwen3.8-flash when only that key is set', () => {
    clearLiveEnv()
    process.env.AI_LIVE_KEY_DASHSCOPE = 'dashscope-test-key'
    const target = resolveLiveLlmTarget()
    expect(target.providerId).toBe(LIVE_DEFAULT_PROVIDER)
    expect(target.modelName).toBe(LIVE_PROVIDER_DEFAULT_MODEL.dashscope)
    expect(target.baseUrl).toBe(
      LLM_PROVIDER_REGISTRY.find((item) => item.id === 'dashscope')?.defaultBaseUrl
    )
    expect(target.apiKey).toBe('dashscope-test-key')
    expect(target.label).toBe('通义千问')
  })

  it('honors AI_LIVE_PROVIDER and AI_LIVE_MODEL overrides', () => {
    clearLiveEnv()
    process.env.AI_LIVE_KEY_DEEPSEEK = 'deepseek-test-key'
    process.env.AI_LIVE_PROVIDER = 'deepseek'
    process.env.AI_LIVE_MODEL = 'deepseek-flash'
    const target = resolveLiveLlmTarget()
    expect(target.providerId).toBe('deepseek')
    expect(target.modelName).toBe('deepseek-flash')
    expect(target.providerKind).toBe('deepseek')
  })

  it('lists only providers that have keys for the smoke matrix', () => {
    clearLiveEnv()
    process.env.AI_LIVE_KEY_DASHSCOPE = 'a'
    process.env.AI_LIVE_KEY_DEEPSEEK = 'b'
    const targets = listConfiguredLiveLlmTargets()
    expect(targets.map((item) => item.providerId)).toEqual(['deepseek', 'dashscope'])
    expect(targets.every((item) => item.modelName === LIVE_PROVIDER_DEFAULT_MODEL[item.providerId])).toBe(
      true
    )
  })

  it('rejects unknown AI_LIVE_PROVIDER', () => {
    clearLiveEnv()
    process.env.AI_LIVE_KEY_DASHSCOPE = 'a'
    process.env.AI_LIVE_PROVIDER = 'openai'
    expect(() => resolveLiveLlmTarget()).toThrow(/AI_LIVE_PROVIDER/)
  })
})
