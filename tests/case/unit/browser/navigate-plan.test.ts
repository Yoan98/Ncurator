import { describe, expect, it } from 'vitest'
import {
  BLANK_PAGE_ERROR,
  formatNavigateNetError,
  formatEmbeddedNetErrorLabel,
  isBlankDocument,
  isAbortedNetError,
  isInternalBrowserErrorUrl,
  isNetErrorDocument,
  parseNavigatePlan,
  parseNetErrorCode,
  shouldPaintEmbeddedNetError
} from '../../../../src/main/services/browser/navigatePlan'

describe('navigatePlan', () => {
  it('fills https only when the url has no scheme', () => {
    expect(parseNavigatePlan('epub.cnipa.gov.cn')).toEqual({
      mode: 'bare',
      url: 'https://epub.cnipa.gov.cn/'
    })
  })

  it('keeps an explicit http or https url without changing the protocol', () => {
    expect(parseNavigatePlan('http://epub.cnipa.gov.cn/')).toEqual({
      mode: 'http',
      url: 'http://epub.cnipa.gov.cn/'
    })
    expect(parseNavigatePlan('https://epub.cnipa.gov.cn/')).toEqual({
      mode: 'https',
      url: 'https://epub.cnipa.gov.cn/'
    })
  })

  it('rejects empty and non-http schemes', () => {
    expect(() => parseNavigatePlan('')).toThrow('请输入网址')
    expect(() => parseNavigatePlan('ftp://example.com')).toThrow('内置浏览器只支持 http/https 地址')
  })

  it('treats chrome error pages and Chromium URL-as-title documents as unusable', () => {
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
        url: 'http://127.0.0.1:64467/task',
        title: '127.0.0.1:64467/task',
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

  it('detects net error documents even when the visible url stays https', () => {
    expect(
      isNetErrorDocument({
        url: 'https://127.0.0.1:1/task',
        title: '无法访问此站点',
        bodyText: 'ERR_CONNECTION_REFUSED 重新加载'
      })
    ).toBe(true)
    expect(
      isNetErrorDocument({
        url: 'https://epub.cnipa.gov.cn/',
        title: '无法访问此站点',
        bodyText: 'ERR_TIMED_OUT 重新加载'
      })
    ).toBe(true)
  })

  it('paints an embedded error page only for main-frame failures that are not aborted', () => {
    expect(
      shouldPaintEmbeddedNetError({
        isMainFrame: true,
        errorCode: -100,
        description: 'ERR_CONNECTION_CLOSED'
      })
    ).toBe(true)
    expect(
      shouldPaintEmbeddedNetError({
        isMainFrame: true,
        errorCode: -7,
        description: 'ERR_TIMED_OUT'
      })
    ).toBe(true)
    expect(
      shouldPaintEmbeddedNetError({
        isMainFrame: true,
        errorCode: -3,
        description: 'ERR_ABORTED'
      })
    ).toBe(false)
    expect(
      shouldPaintEmbeddedNetError({
        isMainFrame: false,
        errorCode: -102,
        description: 'ERR_CONNECTION_REFUSED'
      })
    ).toBe(false)
  })

  it('maps numeric net error codes', () => {
    expect(parseNetErrorCode(-102)).toBe('ERR_CONNECTION_REFUSED')
    expect(parseNetErrorCode(-7)).toBe('ERR_TIMED_OUT')
    expect(isAbortedNetError(-3, 'net::ERR_ABORTED')).toBe(true)
  })

  it('renders Chromium did-fail-load descriptions as the error page label', () => {
    expect(formatEmbeddedNetErrorLabel('net::ERR_CONNECTION_CLOSED', -100)).toBe('ERR_CONNECTION_CLOSED')
    expect(formatEmbeddedNetErrorLabel('net::ERR_NAME_NOT_RESOLVED', -105)).toBe('ERR_NAME_NOT_RESOLVED')
    expect(formatEmbeddedNetErrorLabel('', -102)).toBe('ERR_CONNECTION_REFUSED')
  })

  it('formats net errors for the model without suggesting http fallback', () => {
    expect(
      formatNavigateNetError({
        code: parseNetErrorCode("ERR_CONNECTION_CLOSED (-100) loading 'https://epub.cnipa.gov.cn/'"),
        url: 'https://epub.cnipa.gov.cn/'
      })
    ).toBe('无法访问此站点（ERR_CONNECTION_CLOSED）。https://epub.cnipa.gov.cn/ 连接被服务器断开。')
    expect(
      formatNavigateNetError({
        code: 'ERR_TIMED_OUT',
        url: 'https://epub.cnipa.gov.cn/'
      })
    ).toBe('无法访问此站点（ERR_TIMED_OUT）。https://epub.cnipa.gov.cn/ 连接被服务器断开。')
    expect(BLANK_PAGE_ERROR).toContain('安全验证')
  })
})
