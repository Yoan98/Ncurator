import { describe, expect, it } from 'vitest'
import {
  isProviderFailureCode,
  providerFailure,
  providerFailureCodeForHttp,
  providerFailureMessage,
  providerFailureTitle
} from '../../../../src/main/services/ai/providerFailure'

describe('ai unit provider failure copy', () => {
  it('keeps billing state in provider metadata without including it in failure copy', () => {
    for (const billing of ['waived', 'charged', 'unknown'] as const) {
      expect(providerFailure('upstream_timeout', { billing })).toMatchObject({
        billing, providerCode: 'upstream_timeout', message: '上游模型超时未返回。'
      })
    }
    expect(providerFailureMessage('upstream_interrupted'))
      .toBe('上游连接中断，回答未完整接收。')
    expect(providerFailureMessage('incomplete'))
      .toBe('与馆长服务的连接意外中断，回答未完整接收。')
    expect(providerFailureMessage('timeout'))
      .toBe('等待模型响应超过 5 分钟，已中断。')
    expect(providerFailureMessage('settlement_pending')).toBe('这次请求仍在处理，请稍后再试。')
    expect(providerFailureMessage('settlement_in_progress')).toBe('上一条请求仍在处理，请稍后再试。')
    expect(providerFailureMessage('payment_required')).toContain('请充值')
    expect(providerFailureMessage('balance_insufficient')).toContain('余额不足')
  })

  it('maps stable provider codes to titles and retryability', () => {
    expect(providerFailureTitle('upstream_timeout')).toBe('上游模型超时')
    expect(providerFailureTitle('upstream_interrupted')).toBe('这次没完成，请重试')
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
