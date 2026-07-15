import React, { useEffect, useMemo, useState } from 'react'
import { Button, Empty, Spin, Tooltip } from 'antd'
import {
  HiArrowLeft,
  HiArrowTopRightOnSquare,
  HiArrowUturnLeft,
  HiDocumentText,
  HiEye,
  HiFolder,
  HiFolderOpen,
  HiGlobeAlt,
  HiMapPin,
  HiOutlineMagnifyingGlass,
  HiSparkles
} from 'react-icons/hi2'
import type {
  AiFileChangeRecord,
  BrowserTabState,
  SearchResult,
  WorkspaceSource
} from '../../../../shared/types'
import TextHighlighter from '../TextHighlighter'
import { FileRenderViewer } from '../fileRenders'
import type { FileRenderDocument } from '../fileRenders'
import WorkbenchBrowserPanel from './WorkbenchBrowserPanel'
import type { SearchWorkbenchTurn, WorkbenchContentPanelState, WorkbenchResourceTab } from './types'
import { workbenchSelectors } from '../../testing/selectors'
import ChangeCountBadges from './ChangeCountBadges'
import WorkspacePathLabel from './WorkspacePathLabel'
import { TextFileDiffViewer } from './TextFileDiffViewer'
import WorkbenchTabBar from './WorkbenchTabBar'
import WorkspaceFileExplorer from './WorkspaceFileExplorer'

type WorkbenchContentPanelProps = {
  state: WorkbenchContentPanelState
  tabs: WorkbenchResourceTab[]
  activeTabId: string | null
  activeApplyRecord: AiFileChangeRecord | null
  applyLoading: boolean
  applyReverting: boolean
  workspaces: WorkspaceSource[]
  fallbackWorkspaceName?: string | null
  selectedWorkspace: WorkspaceSource | null
  fileChangeRecords: AiFileChangeRecord[]
  onOpenSearchResult: (turn: SearchWorkbenchTurn, resultIndex: number) => void
  onRevertApply: () => void
  onBackToPanelState: (state: WorkbenchContentPanelState) => void
  onOpenPath: (filePath: string) => Promise<void>
  onRevealPath: (filePath: string) => Promise<void>
  onActivateTab: (tabId: string) => void
  onCloseTab: (tabId: string) => void
  onAddFileTab: () => void
  onAddBrowserTab: () => void
  onBrowserStateChange: (state: BrowserTabState) => void
  onOpenWorkspaceFile: (filePath: string, fileName: string, applyId?: string) => void
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

const getParentPath = (filePath: string): string => {
  const normalized = filePath.replace(/[/\\]+$/, '')
  const separatorIndex = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))
  return separatorIndex > 0 ? normalized.slice(0, separatorIndex) : filePath
}

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

type WorkbenchDocumentPreviewPanelProps = {
  filePath: string
  documents: FileRenderDocument[]
  content?: React.ReactNode
  mode: 'preview' | 'edit'
  status?: AiFileChangeRecord['status']
  operation?: AiFileChangeRecord['operation']
  insertCount?: number
  deleteCount?: number
  testId?: string
  loading?: boolean
  reverting?: boolean
  canRevert?: boolean
  canOpen?: boolean
  errorMessage?: string | null
  emptyText?: string
  workspaces: WorkspaceSource[]
  fallbackWorkspaceName?: string | null
  backTarget?: WorkbenchContentPanelState
  onBackToPanelState: (state: WorkbenchContentPanelState) => void
  onOpenPath: (filePath: string) => Promise<void>
  onRevealPath: (filePath: string) => Promise<void>
  onRevert?: () => void
  explorerOpen?: boolean
  onToggleExplorer?: () => void
}

const WorkbenchDocumentPreviewPanelBase: React.FC<WorkbenchDocumentPreviewPanelProps> = ({
  filePath,
  documents,
  content,
  mode,
  status,
  operation,
  insertCount = 0,
  deleteCount = 0,
  testId,
  loading = false,
  reverting = false,
  canRevert = false,
  canOpen = true,
  errorMessage,
  emptyText,
  workspaces,
  fallbackWorkspaceName,
  backTarget,
  onBackToPanelState,
  onOpenPath,
  onRevealPath,
  onRevert,
  explorerOpen = false,
  onToggleExplorer
}) => {
  const isDeletedCreatedFile = mode === 'edit' && status === 'reverted' && operation === 'created'
  const revealPath = isDeletedCreatedFile ? getParentPath(filePath) : filePath
  const revealTitle = isDeletedCreatedFile ? '定位到所在文件夹' : '定位到系统位置'
  const openTitle = isDeletedCreatedFile ? '文件已删除，不能打开' : '系统默认打开'
  const revertTitle =
    status === 'reverted'
      ? isDeletedCreatedFile
        ? '已回退，文件已删除'
        : '已回退，不能重复操作'
      : operation === 'created'
        ? '回退会删除这个新建文件'
        : '回退本次修改'
  const statusBadgeLabel =
    status === 'reverted' ? (operation === 'created' ? '已删除' : '已回退') : null

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid={testId}>
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-[#EEEEEC] bg-white px-3">
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
            <WorkspacePathLabel
              filePath={filePath}
              workspaces={workspaces}
              fallbackWorkspaceName={fallbackWorkspaceName}
              className="min-w-0 text-[13px] font-semibold"
              prefixClassName="text-[#787774]"
              fileNameClassName="text-[#37352F]"
            />
            {mode === 'edit' ? (
              <>
                <ChangeCountBadges insertCount={insertCount} deleteCount={deleteCount} />
                {statusBadgeLabel ? (
                  <span className="inline-flex h-5 shrink-0 items-center rounded-[4px] bg-[#F4F4F2] px-1.5 text-[11px] font-medium text-[#787774]">
                    {statusBadgeLabel}
                  </span>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {onToggleExplorer ? (
            <Tooltip title={explorerOpen ? '收起工作区文件' : '显示工作区文件'}>
              <Button
                type="text"
                size="small"
                aria-label={explorerOpen ? '收起工作区文件' : '显示工作区文件'}
                icon={<HiFolder className="h-4 w-4" />}
                className={`!text-[#787774] hover:!bg-[#F4F4F2] hover:!text-[#37352F] ${explorerOpen ? '!bg-[#F4F4F2] !text-[#37352F]' : ''}`}
                onClick={onToggleExplorer}
              />
            </Tooltip>
          ) : null}
          <Tooltip title={revealTitle}>
            <Button
              type="text"
              size="small"
              aria-label={revealTitle}
              icon={<HiFolderOpen className="h-4 w-4" />}
              className="!text-[#787774] hover:!bg-[#F4F4F2] hover:!text-[#37352F]"
              data-testid={workbenchSelectors.applyRevealButton}
              onClick={() => void onRevealPath(revealPath)}
            />
          </Tooltip>
          <Tooltip title={openTitle}>
            <Button
              type="text"
              size="small"
              aria-label={openTitle}
              icon={<HiArrowTopRightOnSquare className="h-4 w-4" />}
              className="!text-[#787774] hover:!bg-[#F4F4F2] hover:!text-[#37352F] disabled:!text-[#C9C7C2]"
              data-testid={workbenchSelectors.applyOpenSystemButton}
              disabled={!canOpen || isDeletedCreatedFile}
              onClick={() => {
                if (!canOpen || isDeletedCreatedFile) return
                void onOpenPath(filePath)
              }}
            />
          </Tooltip>
          {mode === 'edit' ? (
            <Tooltip title={revertTitle}>
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
      {errorMessage ? (
        <div className="shrink-0 border-b border-[#E7CAC6] bg-white px-4 py-2.5 text-xs text-[#B3261E]">
          {errorMessage}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 bg-white" data-testid={workbenchSelectors.documentView}>
        {isDeletedCreatedFile && !content ? (
          <div className="flex h-full items-center justify-center">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={<span className="text-[#787774]">该文件已随回退删除</span>}
            />
          </div>
        ) : loading ? (
          <div className="flex h-full items-center justify-center">
            <Spin />
          </div>
        ) : content ? (
          content
        ) : (
          <FileRenderViewer documents={documents} framed={false} emptyText={emptyText} />
        )}
      </div>
    </div>
  )
}

const arePreviewPanelPropsEqual = (
  previous: WorkbenchDocumentPreviewPanelProps,
  next: WorkbenchDocumentPreviewPanelProps
): boolean =>
  previous.filePath === next.filePath &&
  previous.documents === next.documents &&
  previous.content === next.content &&
  previous.mode === next.mode &&
  previous.status === next.status &&
  previous.operation === next.operation &&
  previous.insertCount === next.insertCount &&
  previous.deleteCount === next.deleteCount &&
  previous.testId === next.testId &&
  previous.loading === next.loading &&
  previous.reverting === next.reverting &&
  previous.canRevert === next.canRevert &&
  previous.canOpen === next.canOpen &&
  previous.errorMessage === next.errorMessage &&
  previous.emptyText === next.emptyText &&
  previous.workspaces === next.workspaces &&
  previous.fallbackWorkspaceName === next.fallbackWorkspaceName &&
  previous.backTarget === next.backTarget

const WorkbenchDocumentPreviewPanel = React.memo(
  WorkbenchDocumentPreviewPanelBase,
  arePreviewPanelPropsEqual
)

const WorkbenchContentPanelBase: React.FC<WorkbenchContentPanelProps> = ({
  state,
  tabs,
  activeTabId,
  activeApplyRecord,
  applyLoading,
  applyReverting,
  workspaces,
  fallbackWorkspaceName,
  selectedWorkspace,
  fileChangeRecords,
  onOpenSearchResult,
  onRevertApply,
  onBackToPanelState,
  onOpenPath,
  onRevealPath,
  onActivateTab,
  onCloseTab,
  onAddFileTab,
  onAddBrowserTab,
  onBrowserStateChange,
  onOpenWorkspaceFile
}) => {
  const [explorerOpen, setExplorerOpen] = useState(state.kind === 'file_launcher')

  useEffect(() => {
    if (state.kind === 'file_launcher') setExplorerOpen(true)
  }, [state.kind])
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
  const hasDedicatedPreview = Boolean(activeApplyRecord?.previewPath)
  const applyDocuments = useMemo<FileRenderDocument[]>(() => {
    if (!activeApplyRecord || activeApplyRecord.capability === 'text_file') return []
    const shouldShowCurrentFile =
      activeApplyRecord.status === 'reverted' && activeApplyRecord.operation === 'updated'
    const filePath = shouldShowCurrentFile
      ? activeApplyRecord.path
      : activeApplyRecord.previewPath || activeApplyRecord.path
    return [
      {
        filePath,
        fileName: activeApplyRecord.fileName
      }
    ]
  }, [activeApplyRecord])
  const applyContent = useMemo(
    () =>
      activeApplyRecord?.capability === 'text_file' && activeApplyRecord.previewPath ? (
        <TextFileDiffViewer previewPath={activeApplyRecord.previewPath} />
      ) : undefined,
    [activeApplyRecord]
  )
  const applyEmptyText =
    activeApplyRecord?.status === 'reverted' || hasDedicatedPreview
      ? '当前文件暂时不可预览。'
      : '当前修改记录没有专用预览稿。'

  return (
    <aside
      className="flex h-full min-h-0 flex-col border-l border-[#EEEEEC] bg-white"
      data-testid={workbenchSelectors.contentPanel}
    >
      <WorkbenchTabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onActivateTab={onActivateTab}
        onCloseTab={onCloseTab}
        onAddFileTab={onAddFileTab}
        onAddBrowserTab={onAddBrowserTab}
        onMenuOpenChange={(open) => void window.api.browserPanelSetOccluded(open)}
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="flex h-full min-h-0">
          <div className="min-w-0 flex-1 overflow-hidden">
            {state.kind === 'empty' ? <WorkbenchEmptyPanel /> : null}
            {state.kind === 'file_launcher' ? (
              <div className="flex h-full items-center justify-center text-center">
                <div>
                  <HiFolderOpen className="mx-auto h-10 w-10 text-[#91918E]" />
                  <div className="mt-4 text-[18px] font-semibold text-[#37352F]">打开文件</div>
                  <div className="mt-2 text-sm text-[#91918E]">从右侧工作区文件列表中选择</div>
                </div>
              </div>
            ) : null}
            {state.kind === 'search_list' ? (
              <WorkbenchSearchResultsPanel
                state={state}
                onOpenSearchResult={onOpenSearchResult}
                onRevealPath={onRevealPath}
              />
            ) : null}
            {state.kind === 'file_preview' ? (
              <WorkbenchDocumentPreviewPanel
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
                explorerOpen={explorerOpen}
                onToggleExplorer={() => setExplorerOpen((current) => !current)}
              />
            ) : null}
            {state.kind === 'apply_workspace' ? (
              activeApplyRecord ? (
                <WorkbenchDocumentPreviewPanel
                  filePath={activeApplyRecord.path}
                  documents={applyDocuments}
                  content={applyContent}
                  mode="edit"
                  status={activeApplyRecord.status}
                  operation={activeApplyRecord.operation}
                  insertCount={activeApplyRecord.insertCount}
                  deleteCount={activeApplyRecord.deleteCount}
                  testId={workbenchSelectors.applyPanel}
                  loading={applyLoading}
                  reverting={applyReverting}
                  canRevert={
                    activeApplyRecord.status === 'applied' &&
                    !activeApplyRecord.isSessionAggregate &&
                    !applyReverting
                  }
                  errorMessage={
                    activeApplyRecord.status === 'failed' ? activeApplyRecord.error : null
                  }
                  emptyText={applyEmptyText}
                  workspaces={workspaces}
                  fallbackWorkspaceName={fallbackWorkspaceName}
                  onBackToPanelState={onBackToPanelState}
                  onOpenPath={onOpenPath}
                  onRevealPath={onRevealPath}
                  onRevert={onRevertApply}
                  explorerOpen={explorerOpen}
                  onToggleExplorer={() => setExplorerOpen((current) => !current)}
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
            {state.kind === 'browser' ? (
              <WorkbenchBrowserPanel
                tabId={state.browserTabId}
                onStateChange={onBrowserStateChange}
              />
            ) : null}
          </div>
          {(state.kind === 'file_launcher' ||
            state.kind === 'file_preview' ||
            state.kind === 'apply_workspace') &&
          explorerOpen ? (
            <div className="w-[min(38%,300px)] min-w-[240px] shrink-0">
              <WorkspaceFileExplorer
                workspace={selectedWorkspace}
                changeRecords={fileChangeRecords}
                onOpenFile={(entry, change) =>
                  onOpenWorkspaceFile(entry.absolute_path, entry.name, change?.id)
                }
              />
            </div>
          ) : null}
        </div>
      </div>
    </aside>
  )
}

const areContentPanelPropsEqual = (
  previous: WorkbenchContentPanelProps,
  next: WorkbenchContentPanelProps
): boolean =>
  previous.state === next.state &&
  previous.tabs === next.tabs &&
  previous.activeTabId === next.activeTabId &&
  previous.activeApplyRecord === next.activeApplyRecord &&
  previous.applyLoading === next.applyLoading &&
  previous.applyReverting === next.applyReverting &&
  previous.workspaces === next.workspaces &&
  previous.fallbackWorkspaceName === next.fallbackWorkspaceName &&
  previous.selectedWorkspace === next.selectedWorkspace &&
  previous.fileChangeRecords === next.fileChangeRecords

const WorkbenchContentPanel = React.memo(WorkbenchContentPanelBase, areContentPanelPropsEqual)

export default WorkbenchContentPanel
