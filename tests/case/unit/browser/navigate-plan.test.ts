import { describe, expect, it } from 'vitest'
import {
  BLANK_PAGE_ERROR,
  formatNavigateNetError,
  isBlankDocument,
  isHttpsFallbackWorthy,
  isInternalBrowserErrorUrl,
  parseNavigatePlan,
  parseNetErrorCode
} from '../../../../src/main/services/browser/navigatePlan'

describe('navigatePlan', () => {
  it('tries https then http when the url has no scheme', () => {
    expect(parseNavigatePlan('epub.cnipa.gov.cn')).toEqual({
      mode: 'bare',
      urls: ['https://epub.cnipa.gov.cn/', 'http://epub.cnipa.gov.cn/']
    })
  })

  it('keeps an explicit http or https url without fallback', () => {
    expect(parseNavigatePlan('http://epub.cnipa.gov.cn/').urls).toEqual(['http://epub.cnipa.gov.cn/'])
    expect(parseNavigatePlan('https://epub.cnipa.gov.cn/')).toEqual({
      mode: 'https',
      urls: ['https://epub.cnipa.gov.cn/']
    })
  })

  it('rejects empty and non-http schemes', () => {
    expect(() => parseNavigatePlan('')).toThrow('请输入网址')
    expect(() => parseNavigatePlan('ftp://example.com')).toThrow('内置浏览器只支持 http/https 地址')
  })

  it('falls back to http only for connection and tls failures', () => {
    expect(isHttpsFallbackWorthy('ERR_CONNECTION_CLOSED')).toBe(true)
    expect(isHttpsFallbackWorthy(-100)).toBe(true)
    expect(isHttpsFallbackWorthy('ERR_SSL_PROTOCOL_ERROR')).toBe(true)
    expect(isHttpsFallbackWorthy('ERR_ABORTED')).toBe(false)
    expect(isHttpsFallbackWorthy('ERR_NAME_NOT_RESOLVED')).toBe(false)
  })

  it('treats chrome error pages and hostname-only documents as unusable', () => {
    expect(isInternalBrowserErrorUrl('chrome-error://chromewebdata/')).toBe(true)
    expect(
      isBlankDocument({
        url: 'http://epub.cnipa.gov.cn/',
        title: 'epub.cnipa.gov.cn',
        bodyText: '',
        controlCount: 0
      })
    ).toBe(true)
    expect(
      isBlankDocument({
        url: 'http://epub.cnipa.gov.cn/',
        title: '中国专利公布公告',
        bodyText: '',
        controlCount: 18
      })
    ).toBe(false)
  })

  it('formats net errors for the model', () => {
    expect(
      formatNavigateNetError({
        code: parseNetErrorCode("ERR_CONNECTION_CLOSED (-100) loading 'https://epub.cnipa.gov.cn/'"),
        url: 'https://epub.cnipa.gov.cn/',
        httpsUrl: 'https://epub.cnipa.gov.cn/',
        httpUrl: 'http://epub.cnipa.gov.cn/',
        mode: 'bare',
        exhaustedFallback: true
      })
    ).toBe(
      '无法访问此站点（ERR_CONNECTION_CLOSED）。https://epub.cnipa.gov.cn/ 与 http://epub.cnipa.gov.cn/ 均无法打开。'
    )
    expect(
      formatNavigateNetError({
        code: 'ERR_CONNECTION_CLOSED',
        url: 'https://epub.cnipa.gov.cn/',
        mode: 'https',
        exhaustedFallback: false
      })
    ).toContain('可改试 http。')
    expect(BLANK_PAGE_ERROR).toContain('安全验证')
  })
})
