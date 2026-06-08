import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import WorkbenchContentPanel from '../../../src/renderer/src/components/workbench/WorkbenchContentPanel'
import type { WorkbenchContentPanelState } from '../../../src/renderer/src/components/workbench/types'
import { workbenchSelectors } from '../../../src/renderer/src/testing/selectors'
import type { SearchResult } from '../../../src/shared/types'

vi.mock('../../../src/renderer/src/components/fileRenders', () => ({
  FileRenderViewer: ({ documents }: { documents: Array<{ fileName: string; filePath: string }> }) => (
    <div data-testid="mock-file-render-viewer">
      {documents.map((document) => (
        <span key={document.filePath}>{document.fileName}</span>
      ))}
    </div>
  )
}))

const createSearchResult = (input: {
  id: string
  name: string
  path: string
  sourceType: 'file' | 'web'
}): SearchResult => ({
  id: input.id,
  text: `content for ${input.name}`,
  document_name: input.name,
  source_type: input.sourceType,
  _score: 0.8,
  document: {
    id: `${input.id}-doc`,
    name: input.name,
    source_type: input.sourceType,
    file_path: input.path,
    created_at: 1,
    import_status: 2
  }
})

const renderPanel = (state: WorkbenchContentPanelState) => {
  const props: React.ComponentProps<typeof WorkbenchContentPanel> = {
    state,
    activeApplyRecord: null,
    applyLoading: false,
    applyReverting: false,
    onOpenSearchResult: vi.fn(),
    onSelectApplyTab: vi.fn(),
    onRevertApply: vi.fn(),
    onBackToPanelState: vi.fn(),
    onOpenPath: vi.fn(),
    onOpenWithApplication: vi.fn(),
    onRevealPath: vi.fn()
  }
  render(<WorkbenchContentPanel {...props} />)
  return props
}

describe('WorkbenchContentPanel', () => {
  it('opens local search results through the file preview path', () => {
    const state: WorkbenchContentPanelState = {
      kind: 'search_list',
      title: '搜索结果',
      query: '报告',
      results: [
        createSearchResult({
          id: 'result-1',
          name: 'report.docx',
          path: '/workspace/report.docx',
          sourceType: 'file'
        })
      ],
      tokens: ['报告']
    }
    const props = renderPanel(state)

    fireEvent.click(screen.getByRole('button', { name: '预览文件' }))

    expect(props.onOpenSearchResult).toHaveBeenCalledTimes(1)
    expect(props.onOpenSearchResult).toHaveBeenCalledWith(
      expect.objectContaining({
        query: '报告',
        results: state.results,
        tokens: ['报告']
      }),
      0
    )
  })

  it('renders file preview with back, reveal and system-open controls', () => {
    const backTarget: WorkbenchContentPanelState = {
      kind: 'search_list',
      title: '搜索结果',
      query: '报告',
      results: [],
      tokens: ['报告']
    }
    const state: WorkbenchContentPanelState = {
      kind: 'file_preview',
      title: '文档查看',
      file: {
        path: '/workspace/report.docx',
        fileName: 'report.docx',
        origin: 'search_hit'
      },
      backTarget
    }
    const props = renderPanel(state)

    expect(screen.getByTestId(workbenchSelectors.documentView)).toBeTruthy()
    expect(screen.getAllByText('report.docx').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: '返回' }))
    fireEvent.click(screen.getByRole('button', { name: '定位文件' }))
    fireEvent.click(screen.getByRole('button', { name: '系统打开' }))

    expect(props.onBackToPanelState).toHaveBeenCalledWith(backTarget)
    expect(props.onRevealPath).toHaveBeenCalledWith('/workspace/report.docx')
    expect(props.onOpenPath).toHaveBeenCalledWith('/workspace/report.docx')
  })

  it('opens web search results through the search-result callback without file preview', () => {
    const state: WorkbenchContentPanelState = {
      kind: 'search_list',
      title: '搜索结果',
      query: '网页',
      results: [
        createSearchResult({
          id: 'result-web',
          name: 'Example',
          path: 'https://example.com',
          sourceType: 'web'
        })
      ],
      tokens: ['网页']
    }
    const props = renderPanel(state)

    fireEvent.click(screen.getByRole('button', { name: '打开网页' }))

    expect(props.onOpenSearchResult).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId(workbenchSelectors.documentView)).toBeNull()
  })
})
