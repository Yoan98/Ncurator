import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('workbench markdown renderer reference links', () => {
  let dom: JSDOM
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
      url: 'http://localhost/'
    })
    Object.assign(globalThis, {
      window: dom.window,
      document: dom.window.document,
      HTMLElement: dom.window.HTMLElement,
      SVGElement: dom.window.SVGElement,
      Node: dom.window.Node,
      MouseEvent: dom.window.MouseEvent,
      ShadowRoot: dom.window.ShadowRoot,
      IS_REACT_ACT_ENVIRONMENT: true
    })
    container = dom.window.document.getElementById('root') as HTMLDivElement
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    dom.window.close()
    vi.clearAllMocks()
  })

  it('opens raw windows ncurator file references with the original path', async () => {
    const { default: MarkdownRenderer } =
      await import('../../../../src/renderer/src/components/MarkdownRenderer')
    const onOpenReference = vi.fn()
    const fileName =
      '\u4ea4\u4e92\u5f0f\u63a2\u7a76\u5b66\u4e60\u6848\u4f8b\uff1a\u4ea7\u4e1a\u8f6c\u79fb.docx'
    const filePath = `D:\\1-work-space\\test\\workspace\\.ncurator\\runtime\\assets\\d6fd02d9-b641-4a73-b047-0f286e2e5072\\${fileName}`
    const content = `[${fileName}](ncurator://ref?kind=reference&resourceType=file&accessStatus=accessible&label=${fileName}&path=${filePath})`

    await act(async () => {
      root.render(
        React.createElement(MarkdownRenderer, {
          content,
          onOpenReference
        })
      )
    })

    const link = container.querySelector<HTMLAnchorElement>('.markdown-reference-link')
    expect(link).not.toBeNull()
    link?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))

    expect(onOpenReference).toHaveBeenCalledWith({
      kind: 'reference',
      resourceType: 'file',
      label: fileName,
      path: filePath
    })
  })

  it('renders unavailable evidence as muted text without an icon or click action', async () => {
    const { default: MarkdownRenderer } =
      await import('../../../../src/renderer/src/components/MarkdownRenderer')
    const onOpenReference = vi.fn()
    const content =
      '[lsof 端口检查结果](ncurator://ref?kind=reference&resourceType=file&accessStatus=unavailable&label=lsof%20端口检查结果&path=/tmp/workspace)'

    await act(async () => {
      root.render(
        React.createElement(MarkdownRenderer, {
          content,
          onOpenReference
        })
      )
    })

    const unavailable = container.querySelector<HTMLElement>('.markdown-reference-unavailable')
    expect(unavailable?.textContent).toBe('lsof 端口检查结果')
    expect(unavailable?.getAttribute('data-ref-access-status')).toBe('unavailable')
    expect(unavailable?.querySelector('.markdown-reference-icon')).toBeNull()
    expect(container.querySelector('.markdown-reference-link')).toBeNull()

    unavailable?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    expect(onOpenReference).not.toHaveBeenCalled()
  })

  it('renders historical evidence without accessStatus using the same unavailable UI', async () => {
    const { default: MarkdownRenderer } =
      await import('../../../../src/renderer/src/components/MarkdownRenderer')
    const onOpenReference = vi.fn()
    const content =
      '[历史证据](ncurator://ref?kind=reference&resourceType=file&label=历史证据&path=/tmp/report.docx)'

    await act(async () => {
      root.render(React.createElement(MarkdownRenderer, { content, onOpenReference }))
    })

    const unavailable = container.querySelector<HTMLElement>('.markdown-reference-unavailable')
    expect(unavailable?.textContent).toBe('历史证据')
    expect(unavailable?.getAttribute('data-ref-access-status')).toBe('unavailable')
    expect(container.querySelector('.markdown-reference-icon')).toBeNull()
    expect(container.querySelector('a')).toBeNull()
    expect(onOpenReference).not.toHaveBeenCalled()
  })

  it('does not invent a resource icon for a genuinely invalid link', async () => {
    const { default: MarkdownRenderer } =
      await import('../../../../src/renderer/src/components/MarkdownRenderer')
    const content =
      '[损坏引用](ncurator://ref?kind=broken&resourceType=file&label=损坏引用&path=/tmp/report.docx)'

    await act(async () => {
      root.render(React.createElement(MarkdownRenderer, { content }))
    })

    expect(container.querySelector('.markdown-reference-link-invalid')).not.toBeNull()
    expect(container.querySelector('.markdown-reference-icon')).toBeNull()
  })
})
