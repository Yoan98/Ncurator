import { describe, expect, it } from 'vitest'
import { LlmOutputError, LlmProviderError } from '../../../../src/main/services/ai/errors'
import { classifyLlmErrorKind, classifyLlmRetry } from '../../../../src/main/services/ai/llmRetry'

describe('ai unit llm error classification', () => {
  it('classifies response_format unavailable errors as unknown (no capability fallback)', () => {
    expect(
      classifyLlmErrorKind({
        status: 400,
        response: {
          status: 400,
          data: {
            error: {
              param: 'response_format',
              message: 'This response_format type is unavailable now'
            }
          }
        }
      })
    ).toBe('unknown')
  })

  it('classifies insufficient balance errors as fatal', () => {
    expect(
      classifyLlmErrorKind({
        status: 402,
        response: {
          status: 402,
          data: {
            error: {
              code: 'insufficient_balance',
              message: 'Insufficient Balance'
            }
          }
        }
      })
    ).toBe('fatal')
  })

  it('classifies invalid api key errors as fatal', () => {
    expect(
      classifyLlmErrorKind({
        status: 401,
        response: {
          status: 401,
          data: {
            error: {
              code: 'invalid_api_key',
              message: 'Incorrect API key provided'
            }
          }
        }
      })
    ).toBe('fatal')
  })

  it('classifies rate limit errors as retryable', () => {
    expect(
      classifyLlmErrorKind({
        status: 429,
        response: {
          status: 429,
          data: {
            error: {
              code: 'rate_limit_exceeded',
              message: 'Rate limit exceeded'
            }
          }
        }
      })
    ).toBe('retryable')
  })

  it('classifies 502 as retryable regardless of body text', () => {
    expect(
      classifyLlmErrorKind({
        status: 502,
        response: {
          status: 502,
          data: {
            error: {
              message: 'upstream failed: response_format is not supported'
            }
          }
        }
      })
    ).toBe('retryable')
  })

  it('classifies our call timeout via TIMEOUT code as retryable', () => {
    expect(
      classifyLlmErrorKind(Object.assign(new Error('llm_call_timeout'), { code: 'TIMEOUT' }))
    ).toBe('retryable')
  })

  it('classifies SDK connection errors via constructor name as retryable', () => {
    class APIConnectionError extends Error {
      constructor() {
        super('Connection error.')
        this.name = 'Error'
      }
    }
    const error = new APIConnectionError()
    expect(classifyLlmErrorKind(error)).toBe('retryable')
    expect(classifyLlmRetry(error).delayMs).toBeUndefined()
  })

  it('classifies wrapped SDK connection errors via cause as retryable', () => {
    class APIConnectionError extends Error {
      constructor() {
        super('Connection error.')
        this.name = 'Error'
      }
    }
    expect(classifyLlmErrorKind(new Error('wrapper', { cause: new APIConnectionError() }))).toBe(
      'retryable'
    )
  })

  it('classifies LangChain TimeoutError name as retryable', () => {
    const error = new Error('Request timed out.')
    error.name = 'TimeoutError'
    expect(classifyLlmErrorKind(error)).toBe('retryable')
    expect(classifyLlmRetry(error).delayMs).toBeUndefined()
  })

  it('classifies unwrapped SDK connection timeout via constructor name as retryable', () => {
    class APIConnectionTimeoutError extends Error {
      constructor() {
        super('Request timed out.')
        this.name = 'Error'
      }
    }
    expect(classifyLlmErrorKind(new APIConnectionTimeoutError())).toBe('retryable')
  })

  it('classifies unknown status errors as unknown', () => {
    expect(
      classifyLlmErrorKind({
        status: 404,
        response: {
          status: 404,
          data: {
            error: {
              code: 'ModelNotOpen',
              type: 'Not Found',
              message: 'The selected model is not activated'
            }
          }
        }
      })
    ).toBe('unknown')
  })

  it('does not treat connection or timeout copy as retryable without type signals', () => {
    expect(classifyLlmErrorKind(new Error('network socket disconnected unexpectedly'))).toBe(
      'unknown'
    )
    expect(classifyLlmErrorKind(new Error('Connection error.'))).toBe('unknown')
    expect(classifyLlmErrorKind(new Error('Request timed out.'))).toBe('unknown')
  })

  it('does not treat balance copy as fatal without status or provider code', () => {
    expect(classifyLlmErrorKind(new Error('Insufficient Balance'))).toBe('unknown')
  })

  it('does not treat 409 as retryable', () => {
    expect(
      classifyLlmErrorKind({
        status: 409,
        response: { status: 409, data: { error: { message: 'conflict' } } }
      })
    ).toBe('unknown')
  })

  it('does not retry unknown or fatal errors via classifyLlmRetry', () => {
    expect(
      classifyLlmRetry({
        status: 402,
        response: {
          status: 402,
          data: { error: { code: 'insufficient_balance', message: 'Insufficient Balance' } }
        }
      }).retryable
    ).toBe(false)
    expect(classifyLlmRetry(new Error('weird opaque failure')).retryable).toBe(false)
  })

  it('retries 429/503 via classifyLlmRetry', () => {
    expect(
      classifyLlmRetry({
        status: 429,
        response: {
          status: 429,
          data: { error: { code: 'rate_limit_exceeded', message: 'Rate limit exceeded' } }
        }
      }).retryable
    ).toBe(true)
    expect(
      classifyLlmRetry({
        status: 503,
        response: { status: 503, data: { error: { message: 'service unavailable' } } }
      }).retryable
    ).toBe(true)
  })

  it('uses capacity backoff for 429 rate limits', () => {
    const error = {
      status: 429,
      response: {
        status: 429,
        data: { error: { code: 'rate_limit_exceeded', message: 'Rate limit exceeded' } }
      }
    }
    expect([1, 2, 3, 4, 5].map((attempt) => classifyLlmRetry(error, attempt).delayMs)).toEqual([
      2_000, 4_000, 8_000, 15_000, 15_000
    ])
  })

  it('uses capacity backoff for resource_exhausted code', () => {
    const error = Object.assign(new Error('ResourceExhausted'), {
      status: 503,
      code: 'resource_exhausted'
    })
    expect([1, 2, 3, 4, 5].map((attempt) => classifyLlmRetry(error, attempt).delayMs)).toEqual([
      2_000, 4_000, 8_000, 15_000, 15_000
    ])
  })

  it('reclassifies LlmProviderError instead of trusting its retryable stamp', () => {
    const stampedRetryable = new LlmProviderError({
      message: 'Insufficient Balance',
      httpStatus: 402,
      providerCode: 'insufficient_balance',
      retryable: true
    })
    expect(classifyLlmRetry(stampedRetryable).retryable).toBe(false)

    const stampedFatalButRetryableStatus = new LlmProviderError({
      message: 'temporarily unavailable',
      httpStatus: 503,
      retryable: false
    })
    expect(classifyLlmRetry(stampedFatalButRetryableStatus).retryable).toBe(true)
  })

  it('retries LlmOutputError only when it is marked retryable', () => {
    expect(
      classifyLlmRetry(
        new LlmOutputError({
          message: '模型返回内容无法解析。',
          rawText: 'not json'
        })
      ).retryable
    ).toBe(false)
    expect(
      classifyLlmRetry(
        new LlmOutputError({
          message: '模型返回内容无法解析。',
          rawText: 'not json',
          retryable: true
        })
      ).retryable
    ).toBe(true)
  })

  it('does not retry AbortError or ModelAbortError', () => {
    const abortError = new Error('This operation was aborted')
    abortError.name = 'AbortError'
    expect(classifyLlmRetry(abortError).retryable).toBe(false)

    const modelAbort = new Error('aborted')
    modelAbort.name = 'ModelAbortError'
    expect(classifyLlmRetry(modelAbort).retryable).toBe(false)
  })

  it('does not treat aborted copy without cancel name or code as cancelled retry skip', () => {
    expect(classifyLlmRetry(new Error('aborted')).retryable).toBe(false)
    expect(classifyLlmErrorKind(new Error('aborted'))).toBe('unknown')
  })
})
