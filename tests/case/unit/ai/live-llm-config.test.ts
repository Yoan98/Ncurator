import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { loadLiveVisionLlmConfigFromEnv } from '../../../harness/backend/llmConfig'

const ENV_KEYS = [
  'AI_LIVE_BASE_URL',
  'AI_LIVE_API_KEY',
  'AI_LIVE_PRIMARY_MODEL_NAME',
  'AI_LIVE_VISION_BASE_URL',
  'AI_LIVE_VISION_API_KEY',
  'AI_LIVE_VISUAL_MODEL_NAME',
  'AI_LIVE_VISION_PROVIDER_KIND'
] as const

const originalEnv = new Map<string, string | undefined>()

beforeAll(() => {
  for (const key of ENV_KEYS) originalEnv.set(key, process.env[key])
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key)
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('live LLM configuration', () => {
  it('requires explicit vision model configuration and reports missing env keys', () => {
    process.env.AI_LIVE_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
    process.env.AI_LIVE_API_KEY = 'test-key'
    process.env.AI_LIVE_PRIMARY_MODEL_NAME = 'deepseek-v4-flash'
    delete process.env.AI_LIVE_VISION_BASE_URL
    delete process.env.AI_LIVE_VISION_API_KEY
    delete process.env.AI_LIVE_VISUAL_MODEL_NAME
    delete process.env.AI_LIVE_VISION_PROVIDER_KIND

    expect(() => loadLiveVisionLlmConfigFromEnv()).toThrow('human 缺少 live 模型配置')
  })

  it('honors an explicitly configured image model', () => {
    process.env.AI_LIVE_BASE_URL = 'https://example.test/v1'
    process.env.AI_LIVE_API_KEY = 'primary-key'
    process.env.AI_LIVE_PRIMARY_MODEL_NAME = 'primary-model'
    process.env.AI_LIVE_VISION_BASE_URL = 'https://vision.example.test/v1'
    process.env.AI_LIVE_VISION_API_KEY = 'vision-key'
    process.env.AI_LIVE_VISUAL_MODEL_NAME = 'vision-model'

    const config = loadLiveVisionLlmConfigFromEnv()

    expect(config.model_name).toBe('vision-model')
    expect(config.base_url).toBe('https://vision.example.test/v1')
    expect(config.api_key).toBe('vision-key')
  })
})
