import { describe, expect, it } from 'vitest'
import { isStructuredOutputMethodUnsupportedError } from '../../../src/main/services/ai/structuredOutput'

describe('ai unit structured output fallback', () => {
  it('treats provider jsonSchema compatibility errors as unsupported to allow fallback', () => {
    expect(
      isStructuredOutputMethodUnsupportedError('jsonSchema', {
        message: "Cannot read properties of undefined (reading 'map')"
      })
    ).toBe(true)
  })

  it('treats provider jsonMode compatibility errors as unsupported to allow fallback', () => {
    expect(
      isStructuredOutputMethodUnsupportedError('jsonMode', {
        message: "Cannot read properties of undefined (reading 'message')"
      })
    ).toBe(true)
  })

  it('does not swallow unrelated runtime errors as unsupported', () => {
    expect(
      isStructuredOutputMethodUnsupportedError('jsonSchema', {
        message: 'network socket disconnected unexpectedly'
      })
    ).toBe(false)
  })
})
