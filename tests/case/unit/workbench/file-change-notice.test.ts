// @vitest-environment jsdom
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AiFileChangeRecord } from '../../../../src/shared/types'

vi.mock('../../../../src/renderer/src/components/fileRenders', () => ({
  FileRenderViewer: () => null
}))

import { FileChangeNotice } from '../../../../src/renderer/src/components/workbench/WorkbenchContentPanel'

afterEach(cleanup)

const record = (input: Partial<AiFileChangeRecord> = {}): AiFileChangeRecord => ({
  id: 'change-1',
  sessionId: 'session-1',
  runId: 'run-1',
  status: 'applied',
  capability: 'terminal_exec',
  path: '/workspace/new-name.pptx',
  fileName: 'new-name.pptx',
  operation: 'updated',
  changeCount: 1,
  insertCount: 0,
  deleteCount: 0,
  createdAt: 1,
  updatedAt: 1,
  ...input
})

describe('workbench file change notice', () => {
  it('explains a terminal rename with both file names instead of a missing-preview message', () => {
    render(
      React.createElement(FileChangeNotice, {
        record: record({
          operation: 'renamed',
          beforePath: '/workspace/old-name.pptx',
          afterPath: '/workspace/new-name.pptx'
        })
      })
    )

    expect(screen.getByText('本次修改了文件名')).toBeTruthy()
    expect(screen.getByText('old-name.pptx')).toBeTruthy()
    expect(screen.getByText('new-name.pptx')).toBeTruthy()
    expect(screen.getByText('文件内容没有变化。')).toBeTruthy()
    expect(screen.queryByText('当前修改记录没有专用预览稿。')).toBeNull()
  })

  it('explains unsupported content changes and reverted records', () => {
    const { rerender } = render(React.createElement(FileChangeNotice, { record: record() }))
    expect(screen.getByText('文件已发生修改')).toBeTruthy()
    expect(screen.getByText(/暂不支持在应用内查看差异/)).toBeTruthy()

    rerender(React.createElement(FileChangeNotice, { record: record({ status: 'reverted' }) }))
    expect(screen.getByText('本次修改已回退')).toBeTruthy()
    expect(screen.getByText('文件已经恢复到这次修改发生前的状态。')).toBeTruthy()
  })
})
