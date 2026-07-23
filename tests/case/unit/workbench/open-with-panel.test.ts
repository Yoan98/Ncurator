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

const renderPanel = (openFileWithApplication = vi.fn()) => {
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
        applications: [
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
      onRevealPath: vi.fn()
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
})
