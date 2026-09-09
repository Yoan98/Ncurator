import { describe, expect, it } from 'vitest'
import { LlmProviderError } from '../../../../src/main/services/ai/errors'
import { classifyThrownErrorToAiRunFailure } from '../../../../src/main/services/ai/utils/runFailure'
import { toProviderFailure } from '../../../../src/main/services/ai/utils/structuredChatActivity'

describe('run failure serialization', () => {
  it('maps provider errors to llm_request_failed with raw detail', () => {
    const failure = classifyThrownErrorToAiRunFailure(
      new LlmProviderError({
        message: 'The selected model is not activated',
        httpStatus: 404,
        providerCode: 'ModelNotOpen'
      })
    )
    expect(failure).toMatchObject({
      failureCode: 'llm_request_failed',
      message: '模型请求失败',
      rawMessage: 'The selected model is not activated',
      httpStatus: 404,
      providerCode: 'ModelNotOpen'
    })
  })

  it('maps internal errors to unexpected_error and keeps rawMessage', () => {
    const failure = classifyThrownErrorToAiRunFailure(
      new Error('Recursion limit reached at /Users/example/project/src/main/graph.ts:42')
    )
    expect(failure).toMatchObject({
      failureCode: 'unexpected_error',
      message: '运行失败，请重试',
      rawMessage: 'Recursion limit reached at /Users/example/project/src/main/graph.ts:42'
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
    const failure = classifyThrownErrorToAiRunFailure(wrapped)
    expect(failure).toMatchObject({
      failureCode: 'llm_request_failed',
      message: '模型请求失败',
      rawMessage: 'upstream gateway rejected the request'
    })
  })

  it('maps timeout errors to llm_request_failed with original text', () => {
    const timeout = Object.assign(new Error('llm_call_timeout'), { code: 'TIMEOUT' })
    const failure = classifyThrownErrorToAiRunFailure(toProviderFailure(timeout, false))
    expect(failure.failureCode).toBe('llm_request_failed')
    expect(failure.message).toBe('模型请求失败')
    expect(failure.rawMessage).toContain('llm_call_timeout')
  })
})
