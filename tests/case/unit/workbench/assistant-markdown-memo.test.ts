import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssistantTurnViewModel } from '../../../../src/renderer/src/components/workbench/types'
import type { WorkspaceSource } from '../../../../src/shared/types'

const markdownRenderSpy = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/renderer/src/components/MarkdownRenderer', () => ({
  default: React.memo(
    ({
      content
    }: {
      content: string
      onOpenReference?: (reference: unknown) => void
    }) => {
      markdownRenderSpy(content)
      return React.createElement('div', { 'data-testid': 'mock-markdown' }, content)
    }
  )
}))

describe('workbench assistant markdown memo', () => {
  let dom: JSDOM
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
    Object.assign(globalThis, {
      window: dom.window,
      document: dom.window.document,
      HTMLElement: dom.window.HTMLElement,
      SVGElement: dom.window.SVGElement,
      Node: dom.window.Node,
      IS_REACT_ACT_ENVIRONMENT: true
    })
    container = dom.window.document.getElementById('root') as HTMLDivElement
    root = createRoot(container)
    markdownRenderSpy.mockClear()
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    dom.window.close()
    vi.clearAllMocks()
  })

  it('does not rerender assistant markdown when parent state changes with stable props', async () => {
    const { default: AssistantTurnCard } = await import(
      '../../../../src/renderer/src/components/workbench/AssistantTurnCard'
    )
    const turn: AssistantTurnViewModel = {
      messageId: 'assistant-message-1',
      runId: 'run-1',
      status: 'completed',
      processThoughts: [],
      processGroups: [],
      finalAnswerMarkdown: 'final **answer**',
      artifacts: [],
      applyTargets: [],
      blockers: []
    }
    const workspaces: WorkspaceSource[] = []
    const onOpenFile = vi.fn()
    const onOpenApply = vi.fn()
    const onOpenReference = vi.fn()

    const Parent = ({ tick }: { tick: number }) =>
      React.createElement(
        'div',
        { 'data-parent-tick': tick },
        React.createElement(AssistantTurnCard, {
          messageId: 'assistant-message-1',
          turn,
          isStreaming: false,
          onOpenFile,
          onOpenApply,
          workspaces,
          fallbackWorkspaceName: null,
          onOpenReference
        })
      )

    act(() => {
      root.render(React.createElement(Parent, { tick: 1 }))
    })
    act(() => {
      root.render(React.createElement(Parent, { tick: 2 }))
    })

    expect(markdownRenderSpy).toHaveBeenCalledTimes(1)
    expect(markdownRenderSpy).toHaveBeenCalledWith('final **answer**')
  })
})
