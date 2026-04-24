import { describe, expect, it } from 'vitest'
import {
  classifyStructuredOutputError,
  isStructuredOutputMethodUnsupportedError,
  isStructuredOutputTransportCompatibilityError
} from '../../../src/main/services/ai/structuredOutput'

describe('ai unit structured output fallback', () => {
  it('classifies response_format unavailable errors as capability mismatch', () => {
    expect(
      classifyStructuredOutputError({
        error: {
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
        },
        transport: 'completions',
        method: 'jsonSchema'
      }).kind
    ).toBe('capability_mismatch')
  })

  it('classifies insufficient balance errors as fatal', () => {
    expect(
      classifyStructuredOutputError({
        error: {
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
        },
        transport: 'completions',
        method: 'jsonSchema'
      }).kind
    ).toBe('fatal')
  })

  it('classifies rate limit errors as retryable', () => {
    expect(
      classifyStructuredOutputError({
        error: {
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
        },
        transport: 'responses',
        method: 'jsonSchema'
      }).kind
    ).toBe('retryable')
  })

  it('treats provider jsonSchema unsupported errors as method-level fallback signals', () => {
    expect(
      isStructuredOutputMethodUnsupportedError('jsonSchema', {
        message: 'response_format json schema is not supported by this provider'
      })
    ).toBe(true)
  })

  it('treats provider jsonMode unsupported errors as method-level fallback signals', () => {
    expect(
      isStructuredOutputMethodUnsupportedError('jsonMode', {
        message: 'response_format json_object is not supported by this provider'
      })
    ).toBe(true)
  })

  it('treats provider compatibility crashes as transport-level fallback signals', () => {
    expect(
      isStructuredOutputTransportCompatibilityError('completions', {
        message: "Cannot read properties of undefined (reading 'message')"
      })
    ).toBe(true)
  })

  it('treats legacy protocol errors as completions transport incompatibility', () => {
    expect(
      isStructuredOutputTransportCompatibilityError('completions', {
        message: 'Unsupported legacy protocol: /v1/chat/completions is not supported. Please use /v1/responses.'
      })
    ).toBe(true)
  })

  it('does not swallow unrelated runtime errors as fallback signals', () => {
    expect(
      isStructuredOutputMethodUnsupportedError('jsonSchema', {
        message: 'network socket disconnected unexpectedly'
      })
    ).toBe(false)
    expect(
      isStructuredOutputTransportCompatibilityError('responses', {
        message: 'network socket disconnected unexpectedly'
      })
    ).toBe(false)
  })
})
