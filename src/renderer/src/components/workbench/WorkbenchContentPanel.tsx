import React, { useMemo } from 'react'
import { Button, Empty, Tooltip } from 'antd'
import {
  HiArrowLeft,
  HiArrowTopRightOnSquare,
  HiDocumentText,
  HiEye,
  HiFolderOpen,
  HiGlobeAlt,
  HiMapPin,
  HiOutlineMagnifyingGlass,
  HiSparkles
} from 'react-icons/hi2'
import type { DocxApplyRecord, SearchResult } from '../../../../shared/types'
import TextHighlighter from '../TextHighlighter'
import { FileRenderViewer } from '../fileRenders'
import WorkbenchApplyPanel from './WorkbenchApplyPanel'
import type { SearchWorkbenchTurn, WorkbenchContentPanelState } from './types'
import { workbenchSelectors } from '../../testing/selectors'

type WorkbenchContentPanelProps = {
  state: WorkbenchContentPanelState
  activeApplyRecord: DocxApplyRecord | null
  applyLoading: boolean
  applyReverting: boolean
  onOpenSearchResult: (turn: SearchWorkbenchTurn, resultIndex: number) => void
  onSelectApplyTab: (fileKey: string) => void
  onRevertApply: () => void
  onBackToPanelState: (state: WorkbenchContentPanelState) => void
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
  if (rawScore >= 0 && rawScore <= 1) return Math.round(rawScore * 100)
  if (rawScore > 1 && rawScore <= 100) return Math.round(rawScore)
  if (!scoreExtrema || scoreExtrema.max === scoreExtrema.min) return 100
  const ratio = (rawScore - scoreExtrema.min) / (scoreExtrema.max - scoreExtrema.min)
  return Math.round(40 + ratio * 60)
}

const WorkbenchEmptyPanel: React.FC = () => (
  <div className="flex h-full items-center justify-center px-5 py-4">
    <div className="flex h-full w-full items-center justify-center rounded-[18px] border border-dashed border-[#E1DED6] bg-[#F0EFEB]">
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={<span className="text-[12px] text-[#9C9A94]">右侧暂无内容</span>}
      />
    </div>
  </div>
)

const WorkbenchSearchResultsPanel: React.FC<{
  state: Extract<WorkbenchContentPanelState, { kind: 'search_list' }>
  onOpenSearchResult: (turn: SearchWorkbenchTurn, resultIndex: number) => void
  onRevealPath: (filePath: string) => Promise<void>
}> = ({ state, onOpenSearchResult, onRevealPath }) => {
  const sortedSearchResults = useMemo(() => {
    const getRawScore = (result: SearchResult): number =>
      result._relevance_score ?? result._score ?? Number.NEGATIVE_INFINITY
    return [...state.results].sort((left, right) => getRawScore(right) - getRawScore(left))
  }, [state.results])

  const scoreExtrema = useMemo(() => {
    const scores = sortedSearchResults
      .map((result) => result._relevance_score ?? result._score)
      .filter((score): score is number => Number.isFinite(score))
    if (scores.length === 0) return null
    return {
      min: Math.min(...scores),
      max: Math.max(...scores)
    }
  }, [sortedSearchResults])

  return (
    <div className="flex h-full min-h-0 flex-col px-4 py-4">
      <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-[#9C9A94]">
        <HiOutlineMagnifyingGlass className="h-4 w-4" />
        搜索结果
      </div>
      <div
        className="min-h-0 flex-1 space-y-2 overflow-auto pr-1"
        data-testid={workbenchSelectors.searchResults}
      >
        {sortedSearchResults.map((result, index) => {
          const relevancePercent = getRelevancePercent(result, scoreExtrema)
          const isWeb = result.source_type === 'web'
          const resultPath = result.document?.file_path
          const turnSnapshot = createSearchTurnSnapshot(state, sortedSearchResults)
          return (
            <div
              key={result.id}
              className="w-full rounded-[16px] border border-[#E1DED6] bg-white px-4 py-3 text-left transition-all hover:border-[#181818]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {isWeb ? (
                      <HiGlobeAlt className="h-3.5 w-3.5 shrink-0 text-[#6E6D69]" />
                    ) : (
                      <HiDocumentText className="h-3.5 w-3.5 shrink-0 text-[#181818]" />
                    )}
                    <div className="min-w-0 flex items-center gap-2">
                      <span className="truncate text-[13px] font-medium text-[#181818]">
                        {result.document_name}
                      </span>
                      {relevancePercent !== null ? (
                        <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-[#181818]">
                          <HiSparkles className="h-3.5 w-3.5" />
                          <span>{relevancePercent}%</span>
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <TextHighlighter
                    text={result.text}
                    keywords={state.tokens}
                    className="mt-2 line-clamp-6 text-xs leading-relaxed text-[#6E6D69]"
                  />
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  {isWeb ? (
                    <Tooltip title="打开网页">
                      <Button
                        type="text"
                        size="small"
                        aria-label="打开网页"
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
                            aria-label="预览文件"
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
                            aria-label="定位文件"
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
            </div>
          )
        })}
      </div>
    </div>
  )
}

const WorkbenchFilePreviewPanel: React.FC<{
  state: Extract<WorkbenchContentPanelState, { kind: 'file_preview' }>
  onBackToPanelState: (state: WorkbenchContentPanelState) => void
  onOpenPath: (filePath: string) => Promise<void>
  onRevealPath: (filePath: string) => Promise<void>
}> = ({ state, onBackToPanelState, onOpenPath, onRevealPath }) => {
  const previewDocuments = useMemo(
    () => [
      {
        filePath: state.file.path,
        fileName: state.file.fileName,
        metadata: state.file.pageNumber ? { pageNumber: state.file.pageNumber } : undefined
      }
    ],
    [state.file]
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-[#E1DED6] bg-[#FAF9F5] px-4 py-3">
        {state.backTarget ? (
          <Tooltip title="返回">
              <Button
                type="text"
                size="small"
                aria-label="返回"
                icon={<HiArrowLeft className="h-4 w-4" />}
                onClick={() => onBackToPanelState(state.backTarget!)}
            />
          </Tooltip>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-[#181818]">
            {state.file.fileName}
          </div>
          <div className="mt-1 truncate text-xs text-[#9C9A94]">{state.file.path}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Tooltip title="定位文件">
            <Button
              type="text"
              size="small"
              aria-label="定位文件"
              icon={<HiMapPin className="h-4 w-4" />}
              onClick={() => void onRevealPath(state.file.path)}
            />
          </Tooltip>
          <Tooltip title="系统打开">
            <Button
              type="text"
              size="small"
              aria-label="系统打开"
              icon={<HiFolderOpen className="h-4 w-4" />}
              onClick={() => void onOpenPath(state.file.path)}
            />
          </Tooltip>
        </div>
      </div>
      <div
        className="min-h-0 flex-1 bg-[#FAF9F5] p-3"
        data-testid={workbenchSelectors.documentView}
      >
        <FileRenderViewer documents={previewDocuments} />
      </div>
    </div>
  )
}

const WorkbenchContentPanel: React.FC<WorkbenchContentPanelProps> = ({
  state,
  activeApplyRecord,
  applyLoading,
  applyReverting,
  onOpenSearchResult,
  onSelectApplyTab,
  onRevertApply,
  onBackToPanelState,
  onOpenPath,
  onOpenWithApplication,
  onRevealPath
}) => (
  <aside
    className="flex h-full min-h-0 flex-col border-l border-[#E1DED6] bg-[#FAF9F5]"
    data-testid={workbenchSelectors.contentPanel}
  >
    <div className="min-h-0 flex-1 overflow-hidden">
      {state.kind === 'empty' ? <WorkbenchEmptyPanel /> : null}
      {state.kind === 'search_list' ? (
        <WorkbenchSearchResultsPanel
          state={state}
          onOpenSearchResult={onOpenSearchResult}
          onRevealPath={onRevealPath}
        />
      ) : null}
      {state.kind === 'file_preview' ? (
        <WorkbenchFilePreviewPanel
          state={state}
          onBackToPanelState={onBackToPanelState}
          onOpenPath={onOpenPath}
          onRevealPath={onRevealPath}
        />
      ) : null}
      {state.kind === 'apply_workspace' ? (
        <WorkbenchApplyPanel
          record={activeApplyRecord}
          loading={applyLoading}
          reverting={applyReverting}
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
)

export default WorkbenchContentPanel
