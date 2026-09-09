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
        message: 'Insufficient Balance',
        httpStatus: 402,
        providerCode: 'insufficient_balance',
        retryable: false
      })
    )
    expect(failure.failureCode).toBe('llm_request_failed')
    expect(failure.message).toBe('模型请求失败')
    expect(failure.rawMessage).toBe('Insufficient Balance')
    expect(failure.httpStatus).toBe(402)
    expect(failure.providerCode).toBe('insufficient_balance')
  })

  it('maps unknown errors to unexpected_error with original text', () => {
    const failure = classifyThrownErrorToAiRunFailure(new Error('boom detail'))
    expect(failure.failureCode).toBe('unexpected_error')
    expect(failure.message).toBe('运行失败，请重试')
    expect(failure.rawMessage).toBe('boom detail')
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
