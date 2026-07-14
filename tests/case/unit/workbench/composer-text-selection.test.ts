import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { workbenchSelectors } from '../../../../src/renderer/src/testing/selectors'

vi.mock('antd', () => {
  const App = Object.assign(({ children }: { children?: React.ReactNode }) => children, {
    useApp: () => ({
      message: {
        error: vi.fn(),
        warning: vi.fn(),
        success: vi.fn()
      }
    })
  })
  return {
    App,
    Spin: () => null,
    Tooltip: ({ children }: { children?: React.ReactNode }) => children
  }
})

vi.mock('../../../../src/renderer/src/components/workbench/WorkbenchSelect', () => ({
  default: () => null
}))
vi.mock('../../../../src/renderer/src/components/workbench/WorkbenchModelSelector', () => ({
  default: () => null
}))
vi.mock('../../../../src/renderer/src/components/workbench/composer/ReferenceMentionPanel', () => ({
  default: () => null
}))

describe('workbench composer text selection', () => {
  let dom: JSDOM
  let container: HTMLDivElement
  let root: Root | undefined

  beforeEach(() => {
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
      url: 'http://localhost/'
    })
    Object.assign(globalThis, {
      window: dom.window,
      document: dom.window.document,
      HTMLElement: dom.window.HTMLElement,
      HTMLBRElement: dom.window.HTMLBRElement,
      SVGElement: dom.window.SVGElement,
      Node: dom.window.Node,
      Text: dom.window.Text,
      MouseEvent: dom.window.MouseEvent,
      File: dom.window.File,
      FileReader: dom.window.FileReader,
      Blob: dom.window.Blob,
      IS_REACT_ACT_ENVIRONMENT: true
    })
    Object.assign(dom.window, {
      api: {
        referenceItemList: vi.fn(async () => ({ items: [] }))
      },
      requestAnimationFrame: (callback: FrameRequestCallback) =>
        dom.window.setTimeout(() => callback(Date.now()), 0),
      cancelAnimationFrame: (id: number) => dom.window.clearTimeout(id)
    })
    container = dom.window.document.getElementById('root') as HTMLDivElement
    root = createRoot(container)
  })

  afterEach(() => {
    if (root) {
      act(() => root?.unmount())
    }
    dom.window.close()
    vi.clearAllMocks()
  })

  it('preserves a non-collapsed selection after selection events', async () => {
    const { default: WorkbenchComposer } =
      await import('../../../../src/renderer/src/components/workbench/WorkbenchComposer')
    const draftText = '这是开头，中间这段需要被选中，后面还有文字。'
    const selectedText = '中间这段'

    await act(async () => {
      root?.render(
        React.createElement(WorkbenchComposer, {
          mode: 'ai',
          onModeChange: vi.fn(),
          aiPreference: 'default',
          onAiPreferenceChange: vi.fn(),
          modelConfigs: [],
          modelListsByConfigId: {},
          modelSelection: { mainModel: null, visionModel: null },
          onModelSelectionChange: vi.fn(),
          workspaces: [],
          selectedWorkspaceId: null,
          onWorkspaceChange: vi.fn(),
          onDraftChange: vi.fn(),
          onSubmit: vi.fn(),
          onCancel: vi.fn(),
          loading: false,
          canSubmit: false,
          showCancel: false,
          draftValue: {
            input: draftText,
            contentNodes: [{ kind: 'text', text: draftText }],
            selectedReferences: [],
            attachments: []
          },
          draftKey: 'draft-1',
          requestAttachmentTarget: vi.fn(async () => null)
        })
      )
    })

    const editor = container.querySelector<HTMLElement>(
      `[data-testid="${workbenchSelectors.input}"]`
    )
    expect(editor).not.toBeNull()
    const textNode = Array.from(editor?.childNodes || []).find(
      (node): node is Text => node instanceof Text && node.data.includes(selectedText)
    )
    expect(textNode).toBeTruthy()
    if (!textNode) return

    const offset = textNode.data.indexOf(selectedText)
    const range = document.createRange()
    range.setStart(textNode, offset)
    range.setEnd(textNode, offset + selectedText.length)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    await act(async () => {
      document.dispatchEvent(new dom.window.Event('selectionchange'))
      editor?.dispatchEvent(new dom.window.MouseEvent('mouseup', { bubbles: true }))
      await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0))
    })

    const nextSelection = window.getSelection()
    expect(nextSelection?.toString()).toBe(selectedText)
    expect(nextSelection?.isCollapsed).toBe(false)
    expect(nextSelection?.anchorNode && editor?.contains(nextSelection.anchorNode)).toBe(true)
    expect(nextSelection?.focusNode && editor?.contains(nextSelection.focusNode)).toBe(true)
  })
})
