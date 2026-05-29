import React, { useEffect, useMemo, useState } from 'react'
import { Button, Empty, Modal } from 'antd'
import { HiOutlineMagnifyingGlass } from 'react-icons/hi2'
import type { DocxApplyRecord } from '../../../../shared/types'
import EmbeddedFileViewer from '../fileRenders/EmbeddedFileViewer'
import WorkbenchApplyPanel from './WorkbenchApplyPanel'
import type {
  SearchWorkbenchTurn,
  WorkbenchContentPanelState,
  WorkbenchFileRef
} from './types'
import { workbenchSelectors } from '../../testing/selectors'

type WorkbenchContentPanelProps = {
  state: WorkbenchContentPanelState
  activeApplyRecord: DocxApplyRecord | null
  docxApplyLoading: boolean
  docxApplyReverting: boolean
  modalPreviewFile: WorkbenchFileRef | null
  onOpenSearchResult: (turn: SearchWorkbenchTurn, resultIndex: number) => void
  onSelectApplyTab: (fileKey: string) => void
  onRevertApply: () => void
  onCloseModalPreview: () => void
  onOpenPath: (filePath: string) => Promise<void>
  onOpenWithApplication: (filePath: string) => Promise<void>
  onRevealPath: (filePath: string) => Promise<void>
}

const WorkbenchContentPanel: React.FC<WorkbenchContentPanelProps> = ({
  state,
  activeApplyRecord,
  docxApplyLoading,
  docxApplyReverting,
  modalPreviewFile,
  onOpenSearchResult,
  onSelectApplyTab,
  onRevertApply,
  onCloseModalPreview,
  onOpenPath,
  onOpenWithApplication,
  onRevealPath
}) => {
  const [selectedSearchIndex, setSelectedSearchIndex] = useState(0)
  const searchResetKey = state.kind === 'search_list' ? state.query : state.kind

  useEffect(() => {
    setSelectedSearchIndex(0)
  }, [searchResetKey])

  const selectedSearchResult = useMemo(() => {
    if (state.kind !== 'search_list') return null
    return state.results[selectedSearchIndex] || state.results[0] || null
  }, [selectedSearchIndex, state])

  const modalTitle = modalPreviewFile?.fileName || '文件预览'

  return (
    <>
      <aside
        className="flex h-full min-h-0 flex-col border-l border-[#E5E5E4] bg-[#FCFBF8]"
        data-testid={workbenchSelectors.contentPanel}
      >
        <div className="min-h-0 flex-1 overflow-hidden">
          {state.kind === 'empty' ? (
            <div className="flex h-full items-center justify-center px-5 py-4">
              <div className="flex h-full w-full items-center justify-center rounded-[18px] border border-dashed border-[#E5E5E4] bg-[#FAFAF9]">
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={<span className="text-[12px] text-[#999999]">右侧暂无内容</span>}
                />
              </div>
            </div>
          ) : null}

          {state.kind === 'search_list' ? (
            <div className="flex h-full min-h-0 flex-col px-4 py-4">
              <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-[#999999]">
                <HiOutlineMagnifyingGlass className="h-4 w-4" />
                搜索结果
              </div>
              <div
                className="min-h-0 flex-1 space-y-2 overflow-auto pr-1"
                data-testid={workbenchSelectors.searchResults}
              >
                {state.results.map((result, index) => {
                  const active = index === selectedSearchIndex
                  return (
                    <button
                      key={result.id}
                      type="button"
                      onClick={() => setSelectedSearchIndex(index)}
                      className={`w-full rounded-[16px] border px-4 py-3 text-left transition-all ${
                        active
                          ? 'border-[#D97757] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]'
                          : 'border-[#E5E5E4] bg-white hover:border-[#D97757]'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-medium text-[#1F1F1F]">
                            {result.document_name}
                          </div>
                          <div className="mt-2 line-clamp-4 text-xs leading-relaxed text-[#666666]">
                            {result.text}
                          </div>
                        </div>
                        <span className="rounded-full border border-[#E5E5E4] bg-[#F8F8F7] px-2.5 py-1 text-[11px] text-[#666666]">
                          {result.source_type === 'web' ? '网页' : '本地'}
                        </span>
                      </div>
                    </button>
                  )
                })}
              </div>

              {selectedSearchResult ? (
                <div className="mt-4 rounded-[16px] border border-[#E5E5E4] bg-white px-4 py-4">
                  <div className="text-[12px] font-medium uppercase tracking-[0.16em] text-[#999999]">
                    当前命中
                  </div>
                  <div className="mt-3 text-[13px] font-semibold text-[#1F1F1F]">
                    {selectedSearchResult.document_name}
                  </div>
                  <div className="mt-2 text-xs leading-6 text-[#666666]">
                    {selectedSearchResult.text}
                  </div>
                  <div className="mt-4">
                    <Button
                      type="primary"
                      onClick={() =>
                        onOpenSearchResult(
                          {
                            query: state.query,
                            results: state.results,
                            tokens: state.tokens,
                            createdAt: Date.now()
                          },
                          selectedSearchIndex
                        )
                      }
                    >
                      {selectedSearchResult.source_type === 'web' ? '打开网页' : '预览文件'}
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {state.kind === 'file_preview' ? (
            <div className="flex h-full min-h-0 flex-col">
              <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[#E5E5E4] bg-[#FCFBF8] px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-semibold text-[#1F1F1F]">
                    {state.file.fileName}
                  </div>
                  <div className="mt-1 truncate text-xs text-[#999999]">{state.file.path}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button size="small" onClick={() => void onOpenPath(state.file.path)}>
                    系统打开
                  </Button>
                  <Button
                    size="small"
                    onClick={() => void onOpenWithApplication(state.file.path)}
                  >
                    其他应用
                  </Button>
                  <Button size="small" onClick={() => void onRevealPath(state.file.path)}>
                    定位
                  </Button>
                </div>
              </div>
              <div className="min-h-0 flex-1 bg-[#F5F3EE] p-3" data-testid={workbenchSelectors.documentView}>
                <EmbeddedFileViewer
                  filePath={state.file.path}
                  fileName={state.file.fileName}
                  pageNumber={state.file.pageNumber}
                />
              </div>
            </div>
          ) : null}

          {state.kind === 'apply_workspace' ? (
            <WorkbenchApplyPanel
              record={activeApplyRecord}
              loading={docxApplyLoading}
              reverting={docxApplyReverting}
              tabs={state.tabs}
              onSelectTab={onSelectApplyTab}
              onRevert={onRevertApply}
            />
          ) : null}
        </div>
      </aside>

      <Modal
        title={modalTitle}
        open={Boolean(modalPreviewFile)}
        onCancel={onCloseModalPreview}
        width="72vw"
        data-testid={workbenchSelectors.previewModal}
        footer={
          modalPreviewFile ? (
            [
              <Button key="system" onClick={() => void onOpenPath(modalPreviewFile.path)}>
                系统打开
              </Button>,
              <Button
                key="external"
                onClick={() => void onOpenWithApplication(modalPreviewFile.path)}
              >
                其他应用
              </Button>,
              <Button key="reveal" onClick={() => void onRevealPath(modalPreviewFile.path)}>
                定位
              </Button>,
              <Button key="close" type="primary" onClick={onCloseModalPreview}>
                关闭
              </Button>
            ]
          ) : null
        }
        destroyOnClose
      >
        {modalPreviewFile ? (
          <div className="h-[72vh] min-h-[480px] bg-[#F5F3EE] p-1">
            <EmbeddedFileViewer
              filePath={modalPreviewFile.path}
              fileName={modalPreviewFile.fileName}
              pageNumber={modalPreviewFile.pageNumber}
            />
          </div>
        ) : null}
      </Modal>
    </>
  )
}

export default WorkbenchContentPanel
