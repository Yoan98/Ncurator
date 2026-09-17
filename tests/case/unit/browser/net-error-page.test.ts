import { describe, expect, it } from 'vitest'
import {
  BROWSER_RELOAD_CONSOLE_TOKEN,
  NET_ERROR_PAGE_TITLE,
  buildNetErrorDocumentHtml,
  netErrorDisplayHost
} from '../../../../src/main/services/browser/netErrorPage'

describe('netErrorPage', () => {
  it('builds a Chrome-like error document', () => {
    const html = buildNetErrorDocumentHtml('ERR_CONNECTION_CLOSED', 'https://epub.cnipa.gov.cn/')
    expect(html).toContain(`<title>${NET_ERROR_PAGE_TITLE}</title>`)
    expect(html).toContain(`<h1>${NET_ERROR_PAGE_TITLE}</h1>`)
    expect(html).toContain('无法加载 epub.cnipa.gov.cn')
    expect(html).toContain('尝试：')
    expect(html).toContain('检查网络连接')
    expect(html).toContain('检查代理、防火墙和 DNS 配置')
    expect(html).toContain('ERR_CONNECTION_CLOSED')
    expect(html).toContain('重新加载')
    expect(html).toContain(BROWSER_RELOAD_CONSOLE_TOKEN)
    expect(html).toContain('#f1f3f4')
  })

  it('uses host:port for loopback failures and escapes markup', () => {
    expect(netErrorDisplayHost('https://127.0.0.1:1/task')).toBe('127.0.0.1:1')
    const html = buildNetErrorDocumentHtml('<ERR>', 'https://evil.example/<host>')
    expect(html).toContain('&lt;ERR&gt;')
    expect(html).not.toContain('<ERR>')
  })
})
