import React, { useMemo } from 'react'
import { Button, Empty, Spin, Tooltip } from 'antd'
import {
  HiArrowLeft,
  HiArrowTopRightOnSquare,
  HiArrowUturnLeft,
  HiDocumentText,
  HiEye,
  HiFolderOpen,
  HiGlobeAlt,
  HiMapPin,
  HiOutlineMagnifyingGlass,
  HiSparkles
} from 'react-icons/hi2'
import type { DocxApplyRecord, SearchResult, WorkspaceSource } from '../../../../shared/types'
import TextHighlighter from '../TextHighlighter'
import { FileRenderViewer } from '../fileRenders'
import type { FileRenderDocument } from '../fileRenders'
import WorkbenchBrowserPanel from './WorkbenchBrowserPanel'
import type { SearchWorkbenchTurn, WorkbenchContentPanelState } from './types'
import { workbenchSelectors } from '../../testing/selectors'
import { formatWorkspacePathLabel } from './pathDisplay'

type WorkbenchContentPanelProps = {
  state: WorkbenchContentPanelState
  activeApplyRecord: DocxApplyRecord | null
  applyLoading: boolean
  applyReverting: boolean
  workspaces: WorkspaceSource[]
  fallbackWorkspaceName?: string | null
  onOpenSearchResult: (turn: SearchWorkbenchTurn, resultIndex: number) => void
  onRevertApply: () => void
  onBackToPanelState: (state: WorkbenchContentPanelState) => void
  onOpenPath: (filePath: string) => Promise<void>
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
    <div className="flex h-full w-full items-center justify-center rounded-[8px] border border-dashed border-[#EEEEEC] bg-white">
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={<span className="text-[12px] text-[#9B9A97]">右侧暂无内容</span>}
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
      <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-[#9B9A97]">
        <HiOutlineMagnifyingGlass className="h-4 w-4" />
        搜索结果
      </div>
      <div
        className="min-h-0 flex-1 overflow-auto border-y border-[#EEEEEC] bg-white"
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
              className="w-full border-b border-[#EEEEEC] px-3 py-3 text-left transition-colors last:border-b-0 hover:bg-[#F7F7F5]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {isWeb ? (
                      <HiGlobeAlt className="h-3.5 w-3.5 shrink-0 text-[#787774]" />
                    ) : (
                      <HiDocumentText className="h-3.5 w-3.5 shrink-0 text-[#37352F]" />
                    )}
                    <div className="min-w-0 flex items-center gap-2">
                      <span className="truncate text-[13px] font-medium text-[#37352F]">
                        {result.document_name}
                      </span>
                      {relevancePercent !== null ? (
                        <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-[#37352F]">
                          <HiSparkles className="h-3.5 w-3.5" />
                          <span>{relevancePercent}%</span>
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <TextHighlighter
                    text={result.text}
                    keywords={state.tokens}
                    className="mt-2 line-clamp-6 text-xs leading-relaxed text-[#787774]"
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

const WorkbenchDocumentPreviewPanel: React.FC<{
  fileName: string
  filePath: string
  documents: FileRenderDocument[]
  mode: 'preview' | 'edit'
  testId?: string
  loading?: boolean
  reverting?: boolean
  canRevert?: boolean
  canOpen?: boolean
  statusMessage?: string | null
  errorMessage?: string | null
  emptyText?: string
  workspaces: WorkspaceSource[]
  fallbackWorkspaceName?: string | null
  backTarget?: WorkbenchContentPanelState
  onBackToPanelState: (state: WorkbenchContentPanelState) => void
  onOpenPath: (filePath: string) => Promise<void>
  onRevealPath: (filePath: string) => Promise<void>
  onRevert?: () => void
}> = ({
  fileName,
  filePath,
  documents,
  mode,
  testId,
  loading = false,
  reverting = false,
  canRevert = false,
  canOpen = true,
  statusMessage,
  errorMessage,
  emptyText,
  workspaces,
  fallbackWorkspaceName,
  backTarget,
  onBackToPanelState,
  onOpenPath,
  onRevealPath,
  onRevert
}) => {
  const pathLabel = useMemo(
    () => formatWorkspacePathLabel(filePath, workspaces, fallbackWorkspaceName),
    [fallbackWorkspaceName, filePath, workspaces]
  )
  const tagClassName =
    mode === 'edit'
      ? 'border-[#E8E7E4] bg-[#F7F7F5] text-[#37352F]'
      : 'border-[#EEEEEC] bg-white text-[#787774]'

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid={testId}>
      <div className="flex shrink-0 items-center gap-3 border-b border-[#EEEEEC] bg-white px-4 py-3">
        {backTarget ? (
          <Tooltip title="返回">
            <Button
              type="text"
              size="small"
              aria-label="返回"
              icon={<HiArrowLeft className="h-4 w-4" />}
              className="!text-[#787774] hover:!bg-[#F4F4F2] hover:!text-[#37352F]"
              onClick={() => onBackToPanelState(backTarget)}
            />
          </Tooltip>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <div className="truncate text-[13px] font-semibold text-[#37352F]">{fileName}</div>
            <span
              className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${tagClassName}`}
              data-testid={workbenchSelectors.documentPreviewModeTag}
            >
              {mode === 'edit' ? '编辑' : '预览'}
            </span>
          </div>
          <div className="mt-1 truncate text-xs text-[#B1B0AD]">{pathLabel || filePath}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Tooltip title="定位到系统位置">
            <Button
              type="text"
              size="small"
              aria-label="定位到系统位置"
              icon={<HiFolderOpen className="h-4 w-4" />}
              className="!text-[#787774] hover:!bg-[#F4F4F2] hover:!text-[#37352F]"
              data-testid={workbenchSelectors.applyRevealButton}
              onClick={() => void onRevealPath(filePath)}
            />
          </Tooltip>
          <Tooltip title="系统默认打开">
            <Button
              type="text"
              size="small"
              aria-label="系统默认打开"
              icon={<HiArrowTopRightOnSquare className="h-4 w-4" />}
              className="!text-[#787774] hover:!bg-[#F4F4F2] hover:!text-[#37352F] disabled:!text-[#C9C7C2]"
              data-testid={workbenchSelectors.applyOpenSystemButton}
              disabled={!canOpen}
              onClick={() => {
                if (!canOpen) return
                void onOpenPath(filePath)
              }}
            />
          </Tooltip>
          {mode === 'edit' ? (
            <Tooltip title="回退本次修改">
              <Button
                type="text"
                size="small"
                aria-label="回退本次修改"
                icon={<HiArrowUturnLeft className="h-4 w-4" />}
                className="!text-[#787774] hover:!bg-[#F4F4F2] hover:!text-[#37352F] disabled:!text-[#C9C7C2]"
                loading={reverting}
                disabled={!canRevert}
                data-testid={workbenchSelectors.applyRevertButton}
                onClick={onRevert}
              />
            </Tooltip>
          ) : null}
        </div>
      </div>
      {statusMessage ? (
        <div className="shrink-0 border-b border-[#EEEEEC] bg-white px-4 py-2.5 text-xs text-[#787774]">
          {statusMessage}
        </div>
      ) : null}
      {errorMessage ? (
        <div className="shrink-0 border-b border-[#E7CAC6] bg-white px-4 py-2.5 text-xs text-[#B3261E]">
          {errorMessage}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 bg-white" data-testid={workbenchSelectors.documentView}>
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Spin />
          </div>
        ) : (
          <FileRenderViewer documents={documents} framed={false} emptyText={emptyText} />
        )}
      </div>
    </div>
  )
}

const WorkbenchContentPanel: React.FC<WorkbenchContentPanelProps> = ({
  state,
  activeApplyRecord,
  applyLoading,
  applyReverting,
  workspaces,
  fallbackWorkspaceName,
  onOpenSearchResult,
  onRevertApply,
  onBackToPanelState,
  onOpenPath,
  onRevealPath
}) => {
  const previewDocuments = useMemo<FileRenderDocument[]>(
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
  const applyDocuments = useMemo<FileRenderDocument[]>(
    () =>
      activeApplyRecord?.preview_diff_artifact_path && activeApplyRecord.source_name
        ? [
            {
              filePath: activeApplyRecord.preview_diff_artifact_path,
              fileName: activeApplyRecord.source_name
            }
          ]
        : [],
    [activeApplyRecord?.preview_diff_artifact_path, activeApplyRecord?.source_name]
  )
  const hasDedicatedPreview = Boolean(activeApplyRecord?.preview_diff_checksum)

  return (
    <aside
      className="flex h-full min-h-0 flex-col border-l border-[#EEEEEC] bg-white"
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
          <WorkbenchDocumentPreviewPanel
            fileName={state.file.fileName}
            filePath={state.file.path}
            documents={previewDocuments}
            mode="preview"
            canOpen={!state.file.isDirectory}
            workspaces={workspaces}
            fallbackWorkspaceName={fallbackWorkspaceName}
            backTarget={state.backTarget}
            onBackToPanelState={onBackToPanelState}
            onOpenPath={onOpenPath}
            onRevealPath={onRevealPath}
          />
        ) : null}
        {state.kind === 'apply_workspace' ? (
          activeApplyRecord ? (
            <WorkbenchDocumentPreviewPanel
              fileName={activeApplyRecord.source_name}
              filePath={activeApplyRecord.source_path}
              documents={applyDocuments}
              mode="edit"
              testId={workbenchSelectors.applyPanel}
              loading={applyLoading}
              reverting={applyReverting}
              canRevert={activeApplyRecord.status === 'applied' && !applyReverting}
              statusMessage={
                activeApplyRecord.status === 'reverted' ? '本次 AI 修改已回退。' : null
              }
              errorMessage={activeApplyRecord.status === 'failed' ? activeApplyRecord.error : null}
              emptyText={
                hasDedicatedPreview ? '当前文件暂时不可预览。' : '当前修改记录没有专用预览稿。'
              }
              workspaces={workspaces}
              fallbackWorkspaceName={fallbackWorkspaceName}
              onBackToPanelState={onBackToPanelState}
              onOpenPath={onOpenPath}
              onRevealPath={onRevealPath}
              onRevert={onRevertApply}
            />
          ) : (
            <div
              className="flex h-full items-center justify-center text-sm text-[#9B9A97]"
              data-testid={workbenchSelectors.applyPanel}
            >
              {applyLoading ? <Spin /> : '当前没有 AI 修改记录。'}
            </div>
          )
        ) : null}
        {state.kind === 'browser' ? <WorkbenchBrowserPanel /> : null}
      </div>
    </aside>
  )
}

export default WorkbenchContentPanel
