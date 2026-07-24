// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../src/renderer/src/components/fileRenders', () => ({
  FileRenderViewer: () => null
}))

import { WorkbenchDocumentPreviewPanelBase } from '../../../../src/renderer/src/components/workbench/WorkbenchContentPanel'
import { workbenchSelectors } from '../../../../src/renderer/src/testing/selectors'

afterEach(cleanup)

const renderPanel = (
  openFileWithApplication = vi.fn(),
  applications: Array<{
    id: string
    name: string
    iconDataUrl?: string
    isDefault: boolean
  }> = [
    {
      id: 'com.example.editor',
      name: 'System Editor',
      iconDataUrl: 'data:image/png;base64,AA==',
      isDefault: true
    },
    {
      id: 'com.example.viewer',
      name: 'Viewer',
      isDefault: false
    }
  ],
  overrides: Record<string, unknown> = {}
) => {
  const onOpenPath = vi.fn()
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn() })
  })
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      listOpenWithApplications: vi.fn().mockResolvedValue({
        success: true,
        applications,
        defaultApplicationId: 'com.example.editor'
      }),
      openFileWithApplication
    }
  })
  render(
    React.createElement(WorkbenchDocumentPreviewPanelBase, {
      filePath: '/workspace/report.md',
      documents: [],
      mode: 'preview',
      testId: workbenchSelectors.applyPanel,
      workspaces: [],
      onBackToPanelState: vi.fn(),
      onOpenPath,
      onRevealPath: vi.fn(),
      ...overrides
    })
  )
  return { onOpenPath }
}

describe('workbench open-with panel', () => {
  it('shows the system default app in the compact toolbar button', async () => {
    renderPanel()

    await waitFor(() =>
      expect(screen.getByTestId(workbenchSelectors.openWithButton).textContent).toContain(
        'System Editor'
      )
    )
    expect(screen.getByRole('button', { name: '系统默认打开' })).toBeTruthy()
  })

  it('opens a system-provided alternate application from the dropdown', async () => {
    const openFileWithApplication = vi.fn().mockResolvedValue({ success: true })
    renderPanel(openFileWithApplication)

    await waitFor(() =>
      expect(screen.getByTestId(workbenchSelectors.openWithButton).textContent).toContain(
        'System Editor'
      )
    )
    fireEvent.click(screen.getByRole('button', { name: '选择打开应用' }))

    const alternate = await screen.findByText('Viewer')
    fireEvent.click(alternate)

    await waitFor(() =>
      expect(openFileWithApplication).toHaveBeenCalledWith({
        filePath: '/workspace/report.md',
        applicationId: 'com.example.viewer'
      })
    )
  })

  it('uses the queried default handler from the primary button', async () => {
    const openFileWithApplication = vi.fn().mockResolvedValue({ success: true })
    const { onOpenPath } = renderPanel(openFileWithApplication)

    const primaryButton = await screen.findByRole('button', { name: '系统默认打开' })
    await waitFor(() => expect(primaryButton.textContent).toContain('System Editor'))
    fireEvent.click(primaryButton)

    await waitFor(() =>
      expect(openFileWithApplication).toHaveBeenCalledWith({
        filePath: '/workspace/report.md',
        applicationId: 'com.example.editor'
      })
    )
    expect(onOpenPath).not.toHaveBeenCalled()
  })

  it('renders no more than five application choices', async () => {
    renderPanel(
      vi.fn(),
      Array.from({ length: 7 }, (_, index) => ({
        id: `application-${index}`,
        name: `Application ${index}`,
        isDefault: index === 0
      }))
    )

    await waitFor(() =>
      expect(screen.getByTestId(workbenchSelectors.openWithButton).textContent).toContain(
        'Application 0'
      )
    )
    fireEvent.click(screen.getByRole('button', { name: '选择打开应用' }))

    expect(await screen.findByText('Application 4')).toBeTruthy()
    expect(screen.queryByText('Application 5')).toBeNull()
    expect(screen.queryByText('Application 6')).toBeNull()
  })

  it('orders edit actions and gives the expanded file list a persistent selected state', async () => {
    renderPanel(vi.fn(), undefined, {
      mode: 'edit',
      status: 'applied',
      operation: 'updated',
      canRevert: true,
      previewMode: 'diff',
      onTogglePreviewMode: vi.fn(),
      explorerOpen: false,
      onToggleExplorer: vi.fn()
    })

    await screen.findByTestId(workbenchSelectors.openWithButton)
    const toolbar = screen.getByTestId(workbenchSelectors.documentToolbar)
    const orderedTestIds = Array.from(toolbar.querySelectorAll('[data-testid]'))
      .map((element) => element.getAttribute('data-testid'))
      .filter((value) =>
        [
          workbenchSelectors.openWithMenu,
          workbenchSelectors.applyRevealButton,
          workbenchSelectors.previewModeToggle,
          workbenchSelectors.applyRevertButton,
          workbenchSelectors.workspaceExplorerToggle
        ].includes(value as never)
      )

    expect(orderedTestIds).toEqual([
      workbenchSelectors.openWithMenu,
      workbenchSelectors.applyRevealButton,
      workbenchSelectors.previewModeToggle,
      workbenchSelectors.applyRevertButton,
      workbenchSelectors.workspaceExplorerToggle
    ])
    expect(screen.getByRole('button', { name: '打开对应文件夹' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '展开文件列表' }).getAttribute('aria-pressed')).toBe(
      'false'
    )

    cleanup()
    renderPanel(vi.fn(), undefined, {
      explorerOpen: true,
      onToggleExplorer: vi.fn()
    })
    const expandedButton = await screen.findByRole('button', { name: '收起文件列表' })
    expect(expandedButton.getAttribute('aria-pressed')).toBe('true')
    expect(expandedButton.className).toContain('!border-[#D9D8D4]')
    expect(expandedButton.className).toContain('!bg-[#F1F1EF]')
  })
})
