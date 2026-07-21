// @vitest-environment jsdom
import React from 'react'
import { App as AntdApp } from 'antd'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WorkbenchComposer from '../../../../src/renderer/src/components/workbench/WorkbenchComposer'
import { workbenchSelectors } from '../../../../src/renderer/src/testing/selectors'
import type { ComposerDraftValue } from '../../../../src/renderer/src/components/workbench/composer/types'

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  })
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      referenceItemList: vi.fn().mockResolvedValue({ items: [] })
    }
  })
})

afterEach(cleanup)

const createDraft = (input = ''): ComposerDraftValue => ({
  input,
  contentNodes: input ? [{ kind: 'text', text: input }] : [],
  selectedReferences: [],
  attachments: []
})

const renderComposer = (overrides: Partial<React.ComponentProps<typeof WorkbenchComposer>> = {}) => {
  const onSubmit = vi.fn()
  const onDraftChange = vi.fn()
  const result = render(
    React.createElement(
      AntdApp,
      null,
      React.createElement(WorkbenchComposer, {
        mode: 'ai',
        onModeChange: vi.fn(),
        aiPreference: 'default',
        onAiPreferenceChange: vi.fn(),
        modelConfigs: [],
        modelListsByConfigId: {},
        modelSelection: { modelConfigId: '', modelName: '', visualModelName: '' },
        onModelSelectionChange: vi.fn(),
        workspaces: [
          { id: 'workspace-1', name: '测试工作区', root_path: '/tmp/workspace', created_at: 1, updated_at: 1 }
        ],
        selectedWorkspaceId: 'workspace-1',
        onWorkspaceChange: vi.fn(),
        onDraftChange,
        onSubmit,
        onCancel: vi.fn(),
        loading: false,
        canSubmit: true,
        showCancel: false,
        draftValue: createDraft(),
        draftKey: 'test',
        requestAttachmentTarget: vi.fn().mockResolvedValue(null),
        ...overrides
      })
    )
  )
  return { ...result, onSubmit, onDraftChange }
}

const setCaretAtEnd = (element: HTMLElement): void => {
  const textNode = element.firstChild || element.appendChild(document.createTextNode(''))
  const selection = window.getSelection()
  const range = document.createRange()
  range.setStart(textNode, textNode.textContent?.length || 0)
  range.collapse(true)
  selection?.removeAllRanges()
  selection?.addRange(range)
}

describe('workbench composer keyboard contract', () => {
  it('sends on Enter, inserts a newline on Shift+Enter, and ignores IME Enter', () => {
    const { onSubmit } = renderComposer()
    const editor = screen.getByTestId(workbenchSelectors.input)
    editor.textContent = '第一行'
    setCaretAtEnd(editor)

    fireEvent.keyDown(editor, { key: 'Enter', shiftKey: true })
    expect(editor.textContent).toBe('第一行\n')
    expect(onSubmit).not.toHaveBeenCalled()

    fireEvent.keyDown(editor, { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledTimes(1)

    fireEvent.compositionStart(editor)
    fireEvent.keyDown(editor, { key: 'Enter', isComposing: true })
    expect(onSubmit).toHaveBeenCalledTimes(1)
    fireEvent.compositionEnd(editor)
    fireEvent.keyDown(editor, { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('shows the concrete disabled reason and never submits while disabled', () => {
    const { onSubmit } = renderComposer({
      canSubmit: false,
      submitDisabledReason: '请先绑定工作区'
    })
    const sendButton = screen.getByTestId(workbenchSelectors.sendButton)
    expect((sendButton as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByTestId(workbenchSelectors.composerHint).textContent).toContain(
      '请先绑定工作区'
    )
    fireEvent.click(sendButton)
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
