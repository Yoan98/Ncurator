import { describe, expect, it } from 'vitest'
import { findBrowserTabByUrl, normalizeBrowserUrlKey } from '../../../../src/shared/browserUrl'

describe('browserUrl', () => {
  it('normalizes host case, trailing slash, and drops hash', () => {
    expect(normalizeBrowserUrlKey('HTTPS://Example.COM/path/')).toBe('https://example.com/path')
    expect(normalizeBrowserUrlKey('https://example.com/path#section')).toBe('https://example.com/path')
  })

  it('finds an existing tab by normalized url', () => {
    const tabs = [
      { id: 'a', url: 'https://example.com/other' },
      { id: 'b', url: 'https://WWW.zcat.cn/teach/ai/' }
    ]
    expect(findBrowserTabByUrl(tabs, 'https://www.zcat.cn/teach/ai')?.id).toBe('b')
    expect(findBrowserTabByUrl(tabs, 'https://missing.example')).toBeUndefined()
  })
})
