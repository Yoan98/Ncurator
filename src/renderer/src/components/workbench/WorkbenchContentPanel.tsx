import React, { useEffect, useMemo, useState } from 'react'
import { Button, Empty, Tooltip } from 'antd'
import {
  HiArrowTopRightOnSquare,
  HiDocumentText,
  HiEye,
  HiGlobeAlt,
  HiMapPin,
  HiOutlineMagnifyingGlass,
  HiSparkles
} from 'react-icons/hi2'
import type { DocxApplyRecord, SearchResult } from '../../../../shared/types'
import TextHighlighter from '../TextHighlighter'
import FileRender, { FileRenderViewer } from '../fileRenders'
import WorkbenchApplyPanel from './WorkbenchApplyPanel'
import type { SearchWorkbenchTurn, WorkbenchContentPanelState, WorkbenchFileRef } from './types'
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

const createSearchTurnSnapshot = (
  state: Extract<WorkbenchContentPanelState, { kind: 'search_list' }>,
  results: SearchResult[]
): SearchWorkbenchTurn => ({
  query: state.query,
  results,
  tokens: state.tokens,
  createdAt: Date.now()
})

const getRelevancePercent = (
  result: SearchResult,
  scoreExtrema: { min: number; max: number } | null
): number | null => {
  const rawScore = result._relevance_score ?? result._score
  if (rawScore === undefined || !Number.isFinite(rawScore)) return null
  if (rawScore >= 0 && rawScore <= 1) {
    return Math.round(rawScore * 100)
  }
  if (rawScore > 1 && rawScore <= 100) {
    return Math.round(rawScore)
  }
  if (!scoreExtrema || scoreExtrema.max === scoreExtrema.min) {
    return 100
  }
  const ratio = (rawScore - scoreExtrema.min) / (scoreExtrema.max - scoreExtrema.min)
  return Math.round(40 + ratio * 60)
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

  const sortedSearchResults = useMemo(() => {
    if (state.kind !== 'search_list') return []
    const getRawScore = (result: SearchResult): number =>
      result._relevance_score ?? result._score ?? Number.NEGATIVE_INFINITY
    return [...state.results].sort((left, right) => getRawScore(right) - getRawScore(left))
  }, [state])

  const scoreExtrema = useMemo(() => {
    if (state.kind !== 'search_list') return null
    const scores = sortedSearchResults
      .map((result) => result._relevance_score ?? result._score)
      .filter((score): score is number => Number.isFinite(score))
    if (scores.length === 0) return null
    return {
      min: Math.min(...scores),
      max: Math.max(...scores)
    }
  }, [sortedSearchResults, state])

  const modalDocuments = useMemo(
    () =>
      modalPreviewFile
        ? [
            {
              filePath: modalPreviewFile.path,
              fileName: modalPreviewFile.fileName,
              metadata: modalPreviewFile.pageNumber
                ? { pageNumber: modalPreviewFile.pageNumber }
                : undefined
            }
          ]
        : [],
    [modalPreviewFile]
  )

  const previewDocuments = useMemo(
    () =>
      state.kind === 'file_preview'
        ? [
            {
              filePath: state.file.path,
              fileName: state.file.fileName,
              metadata: state.file.pageNumber ? { pageNumber: state.file.pageNumber } : undefined
            }
          ]
        : [],
    [state]
  )

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
                {sortedSearchResults.map((result, index) => {
                  const active = index === selectedSearchIndex
                  const relevancePercent = getRelevancePercent(result, scoreExtrema)
                  const isWeb = result.source_type === 'web'
                  const resultPath = result.document?.file_path
                  const turnSnapshot = createSearchTurnSnapshot(state, sortedSearchResults)
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
                          <div className="flex items-center gap-2">
                            {isWeb ? (
                              <HiGlobeAlt className="h-3.5 w-3.5 shrink-0 text-[#4F6B95]" />
                            ) : (
                              <HiDocumentText className="h-3.5 w-3.5 shrink-0 text-[#D97757]" />
                            )}
                            <div className="min-w-0 flex items-center gap-2">
                              <span className="truncate text-[13px] font-medium text-[#1F1F1F]">
                                {result.document_name}
                              </span>
                              {relevancePercent !== null ? (
                                <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-[#D97757]">
                                  <HiSparkles className="h-3.5 w-3.5" />
                                  <span>{relevancePercent}%</span>
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <TextHighlighter
                            text={result.text}
                            keywords={state.tokens}
                            className="mt-2 line-clamp-6 text-xs leading-relaxed text-[#666666]"
                          />
                        </div>

                        <div className="flex shrink-0 items-center gap-1">
                          {isWeb ? (
                            <Tooltip title="打开网页">
                              <Button
                                type="text"
                                size="small"
                                icon={<HiArrowTopRightOnSquare className="h-4 w-4" />}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  void onOpenSearchResult(turnSnapshot, index)
                                }}
                              />
                            </Tooltip>
                          ) : (
                            <>
                              <Tooltip title="预览文件">
                                <Button
                                  type="text"
                                  size="small"
                                  icon={<HiEye className="h-4 w-4" />}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    void onOpenSearchResult(turnSnapshot, index)
                                  }}
                                />
                              </Tooltip>
                              <Tooltip title="定位文件">
                                <Button
                                  type="text"
                                  size="small"
                                  disabled={!resultPath}
                                  icon={<HiMapPin className="h-4 w-4" />}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    if (!resultPath) return
                                    void onRevealPath(resultPath)
                                  }}
                                />
                              </Tooltip>
                            </>
                          )}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          ) : null}

          {state.kind === 'file_preview' ? (
            <div className="flex h-full min-h-0 flex-col">
              <div className="flex shrink-0 items-center gap-3 border-b border-[#E5E5E4] bg-[#FCFBF8] px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-semibold text-[#1F1F1F]">
                    {state.file.fileName}
                  </div>
                  <div className="mt-1 truncate text-xs text-[#999999]">{state.file.path}</div>
                </div>
              </div>
              <div
                className="min-h-0 flex-1 bg-[#F5F3EE] p-3"
                data-testid={workbenchSelectors.documentView}
              >
                <FileRenderViewer documents={previewDocuments} />
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
              onOpenPath={onOpenPath}
              onOpenWithApplication={onOpenWithApplication}
              onRevealPath={onRevealPath}
            />
          ) : null}
        </div>
      </aside>

      <FileRender
        title={modalPreviewFile?.fileName || '文件预览'}
        open={Boolean(modalPreviewFile)}
        onCancel={onCloseModalPreview}
        documents={modalDocuments}
        modalTestId={workbenchSelectors.previewModal}
      />
    </>
  )
}

export default WorkbenchContentPanel
