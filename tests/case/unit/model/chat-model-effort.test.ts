import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LlmRuntimeConfig } from '../../../../src/shared/types'

// 拦截真实发往上游的 HTTP 请求，断言 reasoning_effort 确实进入请求体。
// 不能用「读代码推断」代替：ChatOpenAI 的 reasoningEffort 选项只对 o*/gpt-5* 生效，
// 一旦改用该选项，deepseek/glm 型号会被静默丢弃而测试仍然「通过」。
const captured: string[] = []

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', getVersion: () => '0.0.0' } }))

const config = (overrides: Partial<LlmRuntimeConfig>): LlmRuntimeConfig => ({
  id: 'cfg-deepseek',
  name: 'DeepSeek',
  providerKind: 'openai-compatible',
  base_url: 'http://127.0.0.1:1/v1',
  api_key: 'sk-test',
  model_name: 'deepseek-v4.1-flash-1017',
  ...overrides
})

const stubFetch = () => {
  const original = globalThis.fetch
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    captured.push(String(init?.body ?? ''))
    return new Response(JSON.stringify({
      id: 'chatcmpl-test', object: 'chat.completion', created: 1, model: 'test',
      choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  return () => { globalThis.fetch = original }
}

afterEach(() => { captured.length = 0 })

const sendOnce = async (cfg: LlmRuntimeConfig): Promise<Record<string, unknown>> => {
  const { createChatModel } = await import('../../../../src/main/services/llm/chatModel')
  const model = createChatModel(cfg, { temperature: 0.2, streaming: false })
  await model.invoke('ping')
  const body = captured.at(-1)
  if (!body) throw new Error('no request captured')
  return JSON.parse(body) as Record<string, unknown>
}

describe('chat model effort wiring', () => {
  it('sends reasoning_effort on the OpenAI-compatible path', async () => {
    const restore = stubFetch()
    try {
      const body = await sendOnce(config({ effort: 'max' }))
      expect(body.reasoning_effort).toBe('max')
      expect(body.model).toBe('deepseek-v4.1-flash-1017')
    } finally { restore() }
  })

  it('sends every enabled tier verbatim, without local remapping', async () => {
    const restore = stubFetch()
    try {
      for (const tier of ['none', 'low', 'high', 'max']) {
        const body = await sendOnce(config({ effort: tier }))
        expect(body.reasoning_effort, tier).toBe(tier)
      }
    } finally { restore() }
  })

  it('omits the field entirely when the model has no switch', async () => {
    const restore = stubFetch()
    try {
      const body = await sendOnce(config({}))
      expect(body).not.toHaveProperty('reasoning_effort')
    } finally { restore() }
  })

  it('also sends the field through the DeepSeek client path', async () => {
    const restore = stubFetch()
    try {
      const body = await sendOnce(config({ providerKind: 'deepseek', effort: 'low' }))
      expect(body.reasoning_effort).toBe('low')
    } finally { restore() }
  })
})
