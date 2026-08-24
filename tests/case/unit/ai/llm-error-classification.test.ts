import { describe, expect, it } from 'vitest'
import { classifyLlmError } from '../../../../src/main/services/ai/structuredOutput'

describe('ai unit llm error classification', () => {
  it('classifies response_format unavailable errors as unknown (no capability fallback)', () => {
    expect(
      classifyLlmError({
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
      classifyLlmError({
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
      classifyLlmError({
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
      classifyLlmError({
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
      classifyLlmError({
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

  it('classifies timeouts as retryable', () => {
    expect(classifyLlmError(Object.assign(new Error('llm_call_timeout'), { code: 'TIMEOUT' }))).toBe(
      'retryable'
    )
  })

  it('classifies unknown status errors as unknown', () => {
    expect(
      classifyLlmError({
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

  it('does not treat network socket errors as retryable without signals', () => {
    expect(classifyLlmError(new Error('network socket disconnected unexpectedly'))).toBe('unknown')
  })
})
