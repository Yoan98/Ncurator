// @vitest-environment jsdom
import React from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WorkspacePathLabel from '../../../../src/renderer/src/components/workbench/WorkspacePathLabel'
import { TextFileDiffViewer } from '../../../../src/renderer/src/components/workbench/TextFileDiffViewer'
import type { WorkspaceSource } from '../../../../src/shared/types'

afterEach(cleanup)

describe('workbench panel visual contract', () => {
  it('renders assistant file paths with slash separators', () => {
    const workspace: WorkspaceSource = {
      id: 'workspace-1',
      name: 'test',
      root_path: '/workspace',
      created_at: 1,
      updated_at: 1
    }
    render(
      React.createElement(WorkspacePathLabel, {
        filePath: '/workspace/daily/report.md',
        workspaces: [workspace],
        separator: '/'
      })
    )

    expect(screen.getByTitle('test/daily/report.md').textContent).toBe('test/daily/report.md')
  })

  it('makes every diff line fill the scroll canvas width', async () => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        readFile: vi.fn().mockResolvedValue(
          new TextEncoder().encode(
            JSON.stringify({
              version: 2,
              oldLineCount: 0,
              newLineCount: 1,
              hunks: [
                { oldStart: 1, newStart: 1, lines: [{ type: 'add', newLine: 1, text: 'new' }] }
              ]
            })
          )
        )
      }
    })
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      value: class {
        observe(): void {}
        disconnect(): void {}
      }
    })
    const { container } = render(
      React.createElement(TextFileDiffViewer, { previewPath: '/preview.json' })
    )

    await waitFor(() => expect(container.querySelector('[data-diff-line-type="add"]')).toBeTruthy())
    const line = container.querySelector('[data-diff-line-type="add"]')
    expect(line?.className).toContain('w-full')
    expect(line?.parentElement?.className).toContain('w-full')
  })
})
