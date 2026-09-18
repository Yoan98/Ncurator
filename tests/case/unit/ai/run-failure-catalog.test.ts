import { describe, expect, it } from 'vitest'
import {
  AI_RUN_FAILURE_CATALOG,
  resolveAiRunFailurePresentation
} from '../../../../src/main/services/ai/runFailureCatalog'
import {
  classifyThrownErrorToAiRunFailure,
  createAiRunFailure
} from '../../../../src/main/services/ai/utils/runFailure'
import { LlmProviderError } from '../../../../src/main/services/ai/errors'
import { toProviderFailure } from '../../../../src/main/services/ai/utils/structuredChatActivity'

describe('ai unit run failure catalog', () => {
  it('keeps a closed mutually exclusive failure-code set', () => {
    expect(Object.keys(AI_RUN_FAILURE_CATALOG).sort()).toEqual(
      [
        'user_cancelled',
        'process_interrupted',
        'llm_request_failed',
        'output_truncated',
        'input_too_long',
        'runtime_limit',
        'internal_error',
        'unexpected_error'
      ].sort()
    )
  })

  it('preserves rawMessage while using catalog title as message', () => {
    const presentation = resolveAiRunFailurePresentation(
      'llm_request_failed',
      'Insufficient Balance'
    )
    expect(presentation.message).toBe('模型请求失败')
    expect(presentation.rawMessage).toBe('Insufficient Balance')
  })

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

  it('maps unknown errors to unexpected_error with original text', () => {
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

  it('maps AbortError and ModelAbortError to user_cancelled', () => {
    const abortError = new Error('This operation was aborted')
    abortError.name = 'AbortError'
    expect(classifyThrownErrorToAiRunFailure(abortError).failureCode).toBe('user_cancelled')

    const modelAbort = new Error('The user aborted a request')
    modelAbort.name = 'ModelAbortError'
    expect(classifyThrownErrorToAiRunFailure(modelAbort).failureCode).toBe('user_cancelled')
  })

  it('does not map aborted copy without cancel name or code to user_cancelled', () => {
    const failure = classifyThrownErrorToAiRunFailure(new Error('aborted'))
    expect(failure.failureCode).toBe('unexpected_error')
    expect(failure.rawMessage).toBe('aborted')
  })

  it('maps SDK connection errors to llm_request_failed after provider wrap', () => {
    class APIConnectionError extends Error {
      constructor() {
        super('Connection error.')
        this.name = 'Error'
      }
    }
    const failure = classifyThrownErrorToAiRunFailure(toProviderFailure(new APIConnectionError()))
    expect(failure).toMatchObject({
      failureCode: 'llm_request_failed',
      message: '模型请求失败',
      rawMessage: 'Connection error.'
    })
  })

  it('maps TimeoutError to llm_request_failed after provider wrap', () => {
    const timeout = new Error('Request timed out.')
    timeout.name = 'TimeoutError'
    const failure = classifyThrownErrorToAiRunFailure(toProviderFailure(timeout))
    expect(failure).toMatchObject({
      failureCode: 'llm_request_failed',
      message: '模型请求失败',
      rawMessage: 'Request timed out.'
    })
  })

  it('createAiRunFailure embeds catalog title and optional rawMessage', () => {
    const failure = createAiRunFailure({
      failureCode: 'internal_error',
      rawMessage: 'compaction_bookmark_unresolved'
    })
    expect(failure.failureCode).toBe('internal_error')
    expect(failure.message).toBe('运行遇到内部错误')
    expect(failure.rawMessage).toBe('compaction_bookmark_unresolved')
  })
})
