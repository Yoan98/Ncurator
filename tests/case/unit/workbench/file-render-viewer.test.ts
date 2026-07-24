// @vitest-environment jsdom
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-doc-viewer', () => ({
  default: () => React.createElement('div', { 'data-testid': 'doc-viewer' })
}))
vi.mock('../../../../src/renderer/src/components/fileRenders/pdf', () => ({ default: {} }))
vi.mock('../../../../src/renderer/src/components/fileRenders/docx', () => ({ default: {} }))
vi.mock('../../../../src/renderer/src/components/fileRenders/pptx', () => ({ default: {} }))
vi.mock('../../../../src/renderer/src/components/fileRenders/image', () => ({ default: {} }))
vi.mock('../../../../src/renderer/src/components/fileRenders/markdown', () => ({
  CustomMarkdownRenderer: {},
  CustomPlainTextRenderer: {}
}))

import { FileRenderViewer } from '../../../../src/renderer/src/components/fileRenders'

afterEach(cleanup)

describe('file render viewer', () => {
  it('shows a clear support list for unsupported document formats', async () => {
    render(
      React.createElement(FileRenderViewer, {
        documents: [
          {
            fileName: 'legacy.doc',
            filePath: '/not-read/legacy.doc'
          }
        ]
      })
    )

    expect(await screen.findByText(/\.doc 文件暂不支持预览/)).toBeTruthy()
    expect(screen.getByText(/当前支持 PDF、DOCX、PPTX、Markdown、UTF-8 文本/)).toBeTruthy()
  })
})
