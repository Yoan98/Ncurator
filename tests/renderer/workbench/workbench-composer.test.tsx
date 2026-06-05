import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import WorkbenchComposer from '../../../src/renderer/src/components/workbench/WorkbenchComposer'
import { workbenchSelectors } from '../../../src/renderer/src/testing/selectors'

const renderComposer = (overrides: Partial<React.ComponentProps<typeof WorkbenchComposer>> = {}) => {
  const props: React.ComponentProps<typeof WorkbenchComposer> = {
    mode: 'ai',
    onModeChange: vi.fn(),
    activeModelConfig: null,
    remoteModels: [],
    selectedModelName: 'model-a',
    onModelNameChange: vi.fn(),
    workspaces: [{ id: 'workspace-1', name: '工作区', created_at: 1, updated_at: 1 }],
    selectedWorkspaceId: 'workspace-1',
    onWorkspaceChange: vi.fn(),
    onDraftChange: vi.fn(),
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
    loading: false,
    canSubmit: true,
    showCancel: false,
    resetKey: 0,
    contextUsage: null,
    ...overrides
  }
  render(<WorkbenchComposer {...props} />)
  return props
}

describe('WorkbenchComposer', () => {
  it('uses the send button as the only stop control while an ai run is active', () => {
    const onSubmit = vi.fn()
    const onCancel = vi.fn()
    renderComposer({
      loading: false,
      showCancel: true,
      onSubmit,
      onCancel
    })

    expect(screen.queryByTestId(workbenchSelectors.cancelButton)).toBeNull()
    const sendButton = screen.getByTestId(workbenchSelectors.sendButton)
    expect(sendButton.getAttribute('aria-label')).toBe('停止本次运行')

    fireEvent.click(sendButton)

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('disables the stop button only after cancellation is already in progress', () => {
    renderComposer({
      showCancel: true,
      cancelling: true
    })

    expect(screen.getByTestId(workbenchSelectors.sendButton)).toHaveProperty('disabled', true)
  })
})
