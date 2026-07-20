import { describe, expect, it } from 'vitest'
import {
  INTERNAL_RUN_FAILURE_MESSAGE,
  LlmProviderError,
  toRendererRunFailure
} from '../../../../src/main/services/ai/errors'

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

  it('shows a readable message after timeout retries are exhausted', () => {
    const timeout = Object.assign(new Error('llm_call_timeout'), { code: 'TIMEOUT' })

    expect(toRendererRunFailure(timeout)).toEqual({
      source: 'provider',
      message: '模型服务请求超时，请稍后重试。'
    })
  })
})
