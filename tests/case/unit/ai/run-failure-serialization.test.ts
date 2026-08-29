import { describe, expect, it } from 'vitest'
import {
  INTERNAL_RUN_FAILURE_MESSAGE,
  LlmProviderError,
  toRendererRunFailure
} from '../../../../src/main/services/ai/errors'
import { toProviderFailure } from '../../../../src/main/services/ai/utils/structuredChatActivity'

describe('run failure serialization', () => {
  it('preserves provider messages and metadata', () => {
    expect(
      toRendererRunFailure(
        new LlmProviderError({
          message: 'The selected model is not activated',
          httpStatus: 404,
          providerCode: 'ModelNotOpen'
        })
      )
    ).toEqual({
      source: 'provider',
      message: 'The selected model is not activated',
      httpStatus: 404,
      providerCode: 'ModelNotOpen'
    })
  })

  it('does not expose internal error details', () => {
    expect(
      toRendererRunFailure(
        new Error('Recursion limit reached at /Users/example/project/src/main/graph.ts:42')
      )
    ).toEqual({
      source: 'internal',
      message: INTERNAL_RUN_FAILURE_MESSAGE
    })
  })

  it('exposes provider messages even without an http status', () => {
    const raw = Object.assign(new Error('upstream gateway rejected the request'), {
      response: {
        data: { error: { message: 'upstream gateway rejected the request' } }
      }
    })
    const wrapped = toProviderFailure(raw, false)
    expect(wrapped).toBeInstanceOf(LlmProviderError)
    expect(toRendererRunFailure(wrapped)).toEqual({
      source: 'provider',
      message: 'upstream gateway rejected the request'
    })
  })

  it('shows a readable message after timeout retries are exhausted', () => {
    const timeout = Object.assign(new Error('llm_call_timeout'), { code: 'TIMEOUT' })

    expect(toRendererRunFailure(timeout)).toEqual({
      source: 'provider',
      message: '模型服务请求超时，请稍后重试。'
    })
  })
})
