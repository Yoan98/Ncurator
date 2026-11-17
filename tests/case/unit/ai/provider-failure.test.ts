import { describe, expect, it } from 'vitest'
import {
  isProviderFailureCode,
  providerFailure,
  providerFailureCodeForHttp,
  providerFailureMessage,
  providerFailureTitle
} from '../../../../src/main/services/ai/providerFailure'

describe('ai unit provider failure copy', () => {
  it('builds the managed upstream failure copy with billing state', () => {
    expect(providerFailureMessage('upstream_timeout', 'waived'))
      .toBe('上游模型超时未返回。本次未计费。')
    expect(providerFailureMessage('upstream_interrupted', 'waived'))
      .toBe('上游连接中断，回答未完整接收。本次未计费。')
    expect(providerFailureMessage('incomplete', 'unknown'))
      .toBe('与馆长服务的连接意外中断，回答未完整接收。计费状态待确认。')
    expect(providerFailureMessage('timeout', 'unknown'))
      .toBe('等待模型响应超过 5 分钟，已中断。计费状态待确认。')
  })

  it('maps stable provider codes to titles and retryability', () => {
    expect(providerFailureTitle('upstream_timeout')).toBe('上游模型超时')
    expect(providerFailureTitle('upstream_interrupted')).toBe('上游连接中断')
    expect(providerFailureTitle('ModelNotOpen')).toBeUndefined()

    expect(providerFailure('model_concurrency_limited')).toMatchObject({
      providerCode: 'model_concurrency_limited',
      retryable: true
    })
    expect(providerFailure('balance_insufficient')).toMatchObject({
      providerCode: 'balance_insufficient',
      retryable: false
    })
    expect(providerFailure('upstream_quota_exhausted')).toMatchObject({
      providerCode: 'upstream_quota_exhausted',
      retryable: false
    })
    expect(providerFailure('upstream_auth_failed')).toMatchObject({
      providerCode: 'upstream_auth_failed',
      retryable: false
    })
    expect(providerFailure('upstream_rate_limited')).toMatchObject({
      providerCode: 'upstream_rate_limited',
      retryable: true
    })
  })

  it('normalizes upstream HTTP failures without leaking the provider body', () => {
    expect(providerFailureCodeForHttp(401, 'invalid api key')).toBe('upstream_auth_failed')
    expect(providerFailureCodeForHttp(403, 'Not enough quota to pre-consume this request')).toBe('upstream_quota_exhausted')
    expect(providerFailureCodeForHttp(403, 'invalid api key')).toBe('upstream_auth_failed')
    expect(providerFailureCodeForHttp(429, 'rate limited')).toBe('upstream_rate_limited')
    expect(providerFailureCodeForHttp(503, 'upstream unavailable')).toBe('upstream_error')
    expect(providerFailureCodeForHttp(400, 'bad request')).toBeUndefined()
  })

  it('recognizes only known provider codes', () => {
    expect(isProviderFailureCode('upstream_timeout')).toBe(true)
    expect(isProviderFailureCode('not-a-code')).toBe(false)
    expect(isProviderFailureCode(undefined)).toBe(false)
  })
})
