import { describe, expect, it } from 'vitest'
import {
  isStructuredOutputMethodUnsupportedError,
  isStructuredOutputTransportCompatibilityError
} from '../../../src/main/services/ai/structuredOutput'

describe('ai unit structured output fallback', () => {
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
