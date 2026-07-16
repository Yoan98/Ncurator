// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  AiFileChangeRecord,
  WorkspaceSource,
  WorkspaceTreeEntry
} from '../../../../src/shared/types'
import WorkspaceFileExplorer from '../../../../src/renderer/src/components/workbench/WorkspaceFileExplorer'

afterEach(cleanup)

const workspace: WorkspaceSource = {
  id: 'workspace-1',
  name: 'Workspace',
  root_path: '/workspace',
  created_at: 1,
  updated_at: 1
}

const entry: WorkspaceTreeEntry = {
  id: 'file-1',
  workspace_id: workspace.id,
  kind: 'file',
  name: 'notes.txt',
  relative_path: 'notes.txt',
  absolute_path: '/workspace/notes.txt',
  supported_for_index: true
}

const change: AiFileChangeRecord = {
  id: 'change-1',
  sessionId: 'session-1',
  runId: 'run-1',
  status: 'applied',
  capability: 'text_file',
  path: entry.absolute_path,
  fileName: entry.name,
  operation: 'updated',
  beforePath: entry.absolute_path,
  afterPath: entry.absolute_path,
  changeCount: 2,
  insertCount: 1,
  deleteCount: 1,
  createdAt: 1,
  updatedAt: 2
}

describe('workspace file explorer', () => {
  it('opens normal preview in all mode and diff only in changed mode', async () => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        workspaceDirectoryList: vi.fn().mockResolvedValue({ items: [entry], total: 1 })
      }
    })
    const onOpenFile = vi.fn()
    const onOpenChange = vi.fn()
    const commonProps = {
      workspace,
      changeRecords: [change],
      activeFilePath: entry.absolute_path,
      activeChangeId: change.id,
      onModeChange: vi.fn(),
      onOpenFile,
      onOpenChange
    }
    const view = render(React.createElement(WorkspaceFileExplorer, { ...commonProps, mode: 'all' }))

    const allFile = await screen.findByRole('button', { name: /notes\.txt/ })
    expect(allFile.getAttribute('aria-current')).toBe('page')
    fireEvent.click(allFile)
    expect(onOpenFile).toHaveBeenCalledWith(entry)
    expect(onOpenChange).not.toHaveBeenCalled()

    view.rerender(React.createElement(WorkspaceFileExplorer, { ...commonProps, mode: 'changed' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /notes\.txt/ })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /notes\.txt/ }))
    expect(onOpenChange).toHaveBeenCalledWith(change)
  })
})
