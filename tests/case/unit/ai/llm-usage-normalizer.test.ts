import { describe, expect, it } from 'vitest'
import { AIMessage } from '@langchain/core/messages'
import { normalizeLlmUsage } from '../../../../src/main/services/llm/usage'

describe('ai unit llm usage normalizer', () => {
  it('prefers usage metadata input tokens when cache details are present', () => {
    const message = new AIMessage({
      content: 'ok',
      usage_metadata: {
        input_tokens: 321,
        output_tokens: 12,
        total_tokens: 333,
        input_token_details: {
          cache_read: 111
        }
      }
    })

    expect(normalizeLlmUsage({ message, providerKind: 'openai' })).toMatchObject({
      inputTokens: 321,
      outputTokens: 12,
      totalTokens: 333,
      cachedInputTokens: 111,
      source: 'usage_metadata'
    })
  })

  it('reads OpenAI cached tokens from response metadata usage', () => {
    const message = new AIMessage({
      content: 'ok',
      response_metadata: {
        usage: {
          prompt_tokens: 1200,
          completion_tokens: 50,
          total_tokens: 1250,
          prompt_tokens_details: {
            cached_tokens: 800
          }
        }
      }
    })

    expect(normalizeLlmUsage({ message, providerKind: 'openai' })).toMatchObject({
      inputTokens: 1200,
      outputTokens: 50,
      totalTokens: 1250,
      cachedInputTokens: 800,
      cacheHitRate: 800 / 1200,
      source: 'response_metadata'
    })
  })

  it('reads DeepSeek cache hit and miss tokens from response metadata usage', () => {
    const message = new AIMessage({
      content: 'ok',
      response_metadata: {
        usage: {
          prompt_tokens: 2000,
          completion_tokens: 100,
          prompt_cache_hit_tokens: 1500,
          prompt_cache_miss_tokens: 500
        }
      }
    })

    expect(normalizeLlmUsage({ message, providerKind: 'deepseek' })).toMatchObject({
      inputTokens: 2000,
      outputTokens: 100,
      cachedInputTokens: 1500,
      cacheMissInputTokens: 500,
      cacheHitRate: 1500 / 2000,
      source: 'response_metadata'
    })
  })

  it('marks usage as unavailable when metadata has no usage payload', () => {
    const message = new AIMessage({
      content: 'ok',
      response_metadata: {
        finish_reason: 'stop'
      }
    })

    expect(normalizeLlmUsage({ message, providerKind: 'openai-compatible' })).toEqual({
      source: 'unavailable'
    })
  })
})
