import { describe, expect, it } from 'vitest'
import {
  EMBEDDING_INITIALIZATION_ERROR_MESSAGE,
  VC_RUNTIME_ERROR_MESSAGE,
  isVcRuntimeError,
  toEmbeddingInitializationMessage
} from '../../../../src/main/services/vector/embeddingError'

describe('embeddingError', () => {
  it('recognizes VC++ runtime load failures', () => {
    const messages = [
      'A dynamic link library (DLL) initialization routine failed',
      'DLL initialization routine failed',
      'The specified module could not be found. dll load error',
      'error 1114: A dynamic link library (DLL) initialization routine failed'
    ]
    for (const message of messages) {
      expect(isVcRuntimeError(new Error(message))).toBe(true)
    }
  })

  it('matches VC++ runtime patterns case-insensitively', () => {
    expect(isVcRuntimeError(new Error('A Dynamic Link Library (DLL) Initialization Routine Failed'))).toBe(true)
    expect(isVcRuntimeError('Dynamic Link Library load failed')).toBe(true)
  })

  it('does not treat unrelated errors as VC++ runtime failures', () => {
    expect(isVcRuntimeError(new Error('model unavailable'))).toBe(false)
    expect(isVcRuntimeError(new Error('embedding runtime request timed out'))).toBe(false)
    expect(isVcRuntimeError(null)).toBe(false)
    expect(isVcRuntimeError(undefined)).toBe(false)
  })

  it('maps VC++ runtime failures to the runtime library message', () => {
    expect(toEmbeddingInitializationMessage(new Error('dll initialization failed'))).toBe(
      VC_RUNTIME_ERROR_MESSAGE
    )
  })

  it('maps other failures to the generic initialization message', () => {
    expect(toEmbeddingInitializationMessage(new Error('model unavailable'))).toBe(
      EMBEDDING_INITIALIZATION_ERROR_MESSAGE
    )
    expect(toEmbeddingInitializationMessage('something else')).toBe(EMBEDDING_INITIALIZATION_ERROR_MESSAGE)
    expect(toEmbeddingInitializationMessage(null)).toBe(EMBEDDING_INITIALIZATION_ERROR_MESSAGE)
  })
})
