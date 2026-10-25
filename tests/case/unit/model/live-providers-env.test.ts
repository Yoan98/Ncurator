import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  LIVE_DEFAULT_PROVIDER,
  LIVE_PROVIDER_DEFAULT_MODEL,
  LIVE_PRESET_PROVIDER_IDS,
  listConfiguredLiveLlmTargets,
  liveKeyEnvName,
  resolveLiveLlmTarget
} from '../../../../tests/harness/core/liveProviders'
import { LLM_PROVIDER_REGISTRY } from '../../../../src/shared/llmProvider'
import { loadRootEnvOnce } from '../../../../src/main/utils/rootEnv'
import { loadLiveLlmConfigFromEnv } from '../../../../tests/harness/backend/llmConfig'

const clearLiveEnv = (): void => {
  // Seal dotenv before deletes so a later loadRootEnvOnce cannot refill from .env.
  loadRootEnvOnce()
  delete process.env.AI_LIVE_PROVIDER
  delete process.env.AI_LIVE_MODEL
  for (const providerId of LIVE_PRESET_PROVIDER_IDS) {
    delete process.env[liveKeyEnvName(providerId)]
  }
  delete process.env.AI_LIVE_BASE_URL
  delete process.env.AI_LIVE_API_KEY
}

describe('liveProviders harness', () => {
  beforeEach(clearLiveEnv)
  afterEach(clearLiveEnv)

  it('defaults to dashscope + qwen3.8-flash when only that key is set', () => {
    process.env.AI_LIVE_KEY_DASHSCOPE = 'dashscope-test-key'
    process.env.AI_LIVE_BASE_URL = 'http://127.0.0.1:8317/v1'
    process.env.AI_LIVE_API_KEY = 'unused-proxy-key'
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
    process.env.AI_LIVE_KEY_DEEPSEEK = 'deepseek-test-key'
    process.env.AI_LIVE_PROVIDER = 'deepseek'
    process.env.AI_LIVE_MODEL = 'deepseek-flash'
    const target = resolveLiveLlmTarget()
    expect(target.providerId).toBe('deepseek')
    expect(target.modelName).toBe('deepseek-flash')
    expect(target.providerKind).toBe('deepseek')
  })

  it('lists only providers that have keys for the smoke matrix', () => {
    process.env.AI_LIVE_PROVIDER = 'custom'
    process.env.AI_LIVE_BASE_URL = 'http://127.0.0.1:8317/v1'
    process.env.AI_LIVE_API_KEY = 'proxy-test-key'
    process.env.AI_LIVE_MODEL = 'proxy-model'
    process.env.AI_LIVE_KEY_DASHSCOPE = 'a'
    process.env.AI_LIVE_KEY_DEEPSEEK = 'b'
    const targets = listConfiguredLiveLlmTargets()
    expect(targets.map((item) => item.providerId)).toEqual(['deepseek', 'dashscope'])
    expect(
      targets.every((item) => item.modelName === LIVE_PROVIDER_DEFAULT_MODEL[item.providerId])
    ).toBe(true)
  })

  it('rejects unknown AI_LIVE_PROVIDER', () => {
    process.env.AI_LIVE_KEY_DASHSCOPE = 'a'
    process.env.AI_LIVE_PROVIDER = 'openai'
    expect(() => resolveLiveLlmTarget()).toThrow(/AI_LIVE_PROVIDER/)
  })

  it('uses the explicit custom endpoint and model in backend live configuration', () => {
    process.env.AI_LIVE_PROVIDER = 'custom'
    process.env.AI_LIVE_BASE_URL = ' http://127.0.0.1:8317/v1/chat/completions/ '
    process.env.AI_LIVE_API_KEY = ' proxy-test-key '
    process.env.AI_LIVE_MODEL = ' proxy-model '
    process.env.AI_LIVE_KEY_DASHSCOPE = 'unused-paid-key'

    expect(resolveLiveLlmTarget()).toEqual({
      providerId: 'custom',
      label: '自定义测试服务',
      baseUrl: 'http://127.0.0.1:8317/v1',
      providerKind: 'openai-compatible',
      apiKey: 'proxy-test-key',
      modelName: 'proxy-model'
    })
    expect(loadLiveLlmConfigFromEnv()).toEqual({
      id: 'ai-live-custom',
      name: '自定义测试服务',
      base_url: 'http://127.0.0.1:8317/v1',
      providerKind: 'openai-compatible',
      api_key: 'proxy-test-key',
      model_name: 'proxy-model'
    })
  })

  it.each(['AI_LIVE_BASE_URL', 'AI_LIVE_API_KEY', 'AI_LIVE_MODEL'])(
    'rejects a missing %s for custom without falling back to a paid provider',
    (missing) => {
      process.env.AI_LIVE_PROVIDER = 'custom'
      process.env.AI_LIVE_BASE_URL = 'http://127.0.0.1:8317/v1'
      process.env.AI_LIVE_API_KEY = 'proxy-test-key'
      process.env.AI_LIVE_MODEL = 'proxy-model'
      process.env.AI_LIVE_KEY_DASHSCOPE = 'unused-paid-key'
      delete process.env[missing]

      expect(() => resolveLiveLlmTarget()).toThrow(missing)
    }
  )

  it.each(['not-a-url', 'file:///tmp/proxy', 'ftp://127.0.0.1/proxy'])(
    'rejects an invalid custom HTTP endpoint: %s',
    (baseUrl) => {
      process.env.AI_LIVE_PROVIDER = 'custom'
      process.env.AI_LIVE_BASE_URL = baseUrl
      process.env.AI_LIVE_API_KEY = 'proxy-test-key'
      process.env.AI_LIVE_MODEL = 'proxy-model'

      expect(() => resolveLiveLlmTarget()).toThrow(/AI_LIVE_BASE_URL/)
    }
  )
})
