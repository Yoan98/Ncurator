// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WorkspacePathLabel from '../../../../src/renderer/src/components/workbench/WorkspacePathLabel'
import { TextFileDiffViewer } from '../../../../src/renderer/src/components/workbench/TextFileDiffViewer'
import PptDiffViewer from '../../../../src/renderer/src/components/workbench/PptDiffViewer'
import { workbenchSelectors } from '../../../../src/renderer/src/testing/selectors'
import type { AiFileChangeRecord, WorkspaceSource } from '../../../../src/shared/types'

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

  it('shows a created PPT as one final canvas without change markers or filters', async () => {
    const manifest = {
      version: 2,
      operation: 'created',
      slides: [
        {
          slideId: 'slide-1',
          changed: true,
          changes: ['added'],
          after: { index: 1, image: '/after-1.png' }
        },
        {
          slideId: 'slide-2',
          changed: true,
          changes: ['added'],
          after: { index: 2, image: '/after-2.png' }
        }
      ]
    }
    mockPptFiles(manifest)
    const { container } = render(
      React.createElement(PptDiffViewer, { record: pptRecord('created') })
    )

    await waitFor(() => expect(screen.getByTestId(workbenchSelectors.pptDiffAfter)).toBeTruthy())
    expect(screen.queryByTestId(workbenchSelectors.pptDiffBefore)).toBeNull()
    expect(screen.queryByText('修改后')).toBeNull()
    expect(screen.queryByRole('button', { name: '查看全部页' })).toBeNull()
    expect(screen.queryByLabelText('新增页')).toBeNull()
    const thumbnails = container.querySelectorAll(
      `[data-testid="${workbenchSelectors.pptDiffThumbnails}"] button`
    )
    expect(thumbnails).toHaveLength(2)
    expect(thumbnails[1]?.className).toContain('border-transparent')
  })

  it('shows updated PPT markers and supports shared wheel zoom and drag pan', async () => {
    const manifest = {
      version: 2,
      operation: 'updated',
      slides: [
        {
          slideId: 'slide-1',
          changed: true,
          changes: ['modified'],
          before: { index: 1, image: '/before-1.png' },
          after: { index: 1, image: '/after-1.png' }
        },
        {
          slideId: 'slide-2',
          changed: true,
          changes: ['deleted'],
          before: { index: 2, image: '/before-2.png' }
        },
        {
          slideId: 'slide-3',
          changed: false,
          changes: [],
          before: { index: 3, image: '/before-3.png' },
          after: { index: 3, image: '/after-3.png' }
        }
      ]
    }
    mockPptFiles(manifest)
    Object.defineProperty(window, 'PointerEvent', {
      configurable: true,
      value: MouseEvent
    })
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      configurable: true,
      value: vi.fn()
    })
    render(React.createElement(PptDiffViewer, { record: pptRecord('updated') }))

    const after = await screen.findByTestId(workbenchSelectors.pptDiffAfter)
    expect(screen.getByTestId(workbenchSelectors.pptDiffBefore)).toBeTruthy()
    expect(screen.getByRole('button', { name: '查看全部页' })).toBeTruthy()
    expect(screen.getByLabelText('内容已修改').className).toContain('bg-[#16A34A]')
    expect(screen.getByLabelText('已删除').className).toContain('bg-[#DC2626]')
    fireEvent.wheel(after, { deltaY: -100, clientX: 200, clientY: 120 })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '适应窗口' }).textContent).toBe('112%')
    )
    const transformNode = after.querySelector<HTMLElement>('[style*="transform"]')!
    const beforeDrag = transformNode.style.transform
    fireEvent.pointerDown(after, { pointerId: 7, clientX: 200, clientY: 120 })
    fireEvent.pointerMove(after, { pointerId: 7, clientX: 240, clientY: 150 })
    expect(transformNode.style.transform).not.toBe(beforeDrag)
    const beforeCoordinates = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(beforeDrag)!
    const afterCoordinates = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(
      transformNode.style.transform
    )!
    expect(Number(afterCoordinates[1]) - Number(beforeCoordinates[1])).toBeCloseTo(40)
    expect(Number(afterCoordinates[2]) - Number(beforeCoordinates[2])).toBeCloseTo(30)
  })
})

const pptRecord = (operation: 'created' | 'updated'): AiFileChangeRecord => ({
  id: `ppt-${operation}`,
  sessionId: 'session-1',
  runId: 'run-1',
  status: 'applied',
  capability: 'ppt',
  path: '/deck.pptx',
  fileName: 'deck.pptx',
  operation,
  changeCount: 2,
  insertCount: 2,
  deleteCount: 0,
  previewPath: `/manifest-${operation}.json`,
  createdAt: 1,
  updatedAt: 1
})

const mockPptFiles = (manifest: object): void => {
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:preview')
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn()
  })
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      readFile: vi.fn(async (filePath: string) =>
        filePath.endsWith('.json')
          ? new TextEncoder().encode(JSON.stringify(manifest))
          : new Uint8Array([137, 80, 78, 71])
      )
    }
  })
}
