import FileIcon from '../FileIcon'
import React, { useEffect, useMemo, useState } from 'react'
import { Button, Dropdown, Empty, Spin, Tooltip, message, type MenuProps } from 'antd'
import {
  HiArrowLeft,
  HiArrowTopRightOnSquare,
  HiArrowUturnLeft,
  HiArrowsRightLeft,
  HiChevronDown,
  HiDocumentText,
  HiOutlineQuestionMarkCircle
} from 'react-icons/hi2'
import type {
  AiFileChangeRecord,
  BrowserTabState,
  OpenWithApplication,
  WorkspaceSource,
  WorkspaceTreeEntry
} from '../../../../shared/types'
import { FileRenderViewer } from '../fileRenders'
import type { FileRenderDocument } from '../fileRenders'
import { classifyEditableTextKind, type EditableTextKind } from '../fileRenders/editableTextKind'
import { resolveRegisteredPreviewType } from '../fileRenders/capabilities'
import WorkbenchBrowserPanel from './WorkbenchBrowserPanel'
import type { WorkbenchContentPanelState, WorkbenchResourceTab, WorkspaceLoadState } from './types'
import { workbenchSelectors } from '../../testing/selectors'
import ChangeCountBadges from './ChangeCountBadges'
import WorkspacePathLabel from './WorkspacePathLabel'
import { TextFileDiffViewer } from './TextFileDiffViewer'
import PptDiffViewer from './PptDiffViewer'
import WorkbenchTabBar from './WorkbenchTabBar'
import WorkspaceFileExplorer, { type WorkspaceFileExplorerMode } from './WorkspaceFileExplorer'
import WorkspaceFilesEmptyState from './WorkspaceFilesEmptyState'
import { findLatestFileChangeForPath } from './fileChangeGroups'
import { shouldShowWpsOpenWithHint, WPS_OPEN_WITH_HINT } from './wpsOpenWithHint'

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
  workspaceLoadState: WorkspaceLoadState
  onOpenWorkspaceSettings: () => void
  onReloadWorkspaces: () => void
  fileChangeRecords: AiFileChangeRecord[]
  partnerFileChangeRecords: AiFileChangeRecord[]
  onRevertApply: () => void
  onBackToPanelState: (state: WorkbenchContentPanelState) => void
  isAiRunActive: boolean
  onSuccessMessage: (content: string) => void
  onInfoMessage: (content: string) => void
  onOpenPath: (filePath: string) => Promise<boolean>
  onRevealPath: (filePath: string) => Promise<void>
  onActivateTab: (tabId: string) => void
  onCloseTab: (tabId: string) => void
  onAddFileTab: () => void
  onAddBrowserTab: () => void
  onCollapse: () => void
  onBrowserStateChange: (state: BrowserTabState) => void
  onOpenWorkspaceFile: (filePath: string, fileName: string) => void
  onWorkspaceFileRenamed: (oldPath: string, entry: WorkspaceTreeEntry) => void
  onOpenWorkspaceChange: (changeId: string) => void
  browserPresentationEnabled: boolean
  browserTransitionImage?: { tabId: string; dataUrl: string } | null
}

type DocumentDisplayMode = 'preview' | 'review'

const getDefaultDocumentDisplayMode = (
  status: AiFileChangeRecord['status'] | null | undefined
): DocumentDisplayMode => (status === 'reverted' ? 'preview' : 'review')

const canSwitchDocumentDisplayMode = (record: AiFileChangeRecord | null): boolean =>
  Boolean(
    record &&
    record.operation !== 'renamed' &&
    record.operation !== 'deleted' &&
    (record.capability === 'docx' ||
      record.capability === 'ppt' ||
      record.capability === 'excel' ||
      record.capability === 'text_file') &&
    record.previewPath &&
    (record.afterSnapshotPath || record.path)
  )

const getApplyDocumentPath = (
  record: AiFileChangeRecord,
  displayMode: DocumentDisplayMode
): string => {
  if (displayMode === 'preview') return record.path
  return record.previewPath || ''
}

const getPathFileName = (value?: string): string => {
  const normalized = (value || '').replace(/\\/g, '/').replace(/\/+$/g, '')
  return normalized.split('/').filter(Boolean).pop() || normalized
}

export const FileChangeNotice: React.FC<{ record: AiFileChangeRecord }> = ({ record }) => {
  let title = '文件已发生修改'
  let description = '暂不支持在应用内审核该文件的修改，你可以使用系统应用打开文件查看。'

  if (record.status === 'reverted') {
    title = '本次修改已回退'
    description = '文件已经恢复到这次修改发生前的状态。'
  } else if (record.operation === 'renamed') {
    title = '本次修改了文件名'
    description = '文件内容没有变化。'
  } else if (record.operation === 'deleted') {
    title = '本次删除了该文件'
    description = '你可以通过回退恢复文件。'
  }

  return (
    <div
      className="flex h-full items-center justify-center px-8 text-center"
      data-testid={workbenchSelectors.applyChangeNotice}
    >
      <div className="max-w-[460px]">
        <HiDocumentText className="mx-auto h-10 w-10 text-[#B7B5AF]" />
        <div className="mt-4 text-[15px] font-semibold text-[#37352F]">{title}</div>
        {record.operation === 'renamed' && record.status !== 'reverted' ? (
          <div className="mt-4 grid grid-cols-[minmax(0,1fr)_20px_minmax(0,1fr)] items-center gap-2 text-left text-[13px]">
            <div className="min-w-0 rounded-[6px] bg-[#F4F4F2] px-3 py-2">
              <div className="text-[11px] text-[#91918E]">原文件名</div>
              <div className="mt-0.5 truncate text-[#57554F]" title={record.beforePath}>
                {getPathFileName(record.beforePath)}
              </div>
            </div>
            <HiArrowsRightLeft className="h-4 w-4 text-[#B7B5AF]" />
            <div className="min-w-0 rounded-[6px] bg-[#F4F4F2] px-3 py-2">
              <div className="text-[11px] text-[#91918E]">当前文件名</div>
              <div className="mt-0.5 truncate text-[#37352F]" title={record.afterPath}>
                {getPathFileName(record.afterPath || record.path)}
              </div>
            </div>
          </div>
        ) : null}
        <div className="mt-2 text-[13px] leading-6 text-[#787774]">{description}</div>
      </div>
    </div>
  )
}

const WorkbenchEmptyPanel: React.FC = () => (
  <div className="flex h-full items-center justify-center px-5 py-4">
    <div className="flex h-full w-full items-center justify-center rounded-[8px] border border-dashed border-[#EEEEEC] bg-white">
      <div className="text-center">
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={<span className="text-[12px] text-[#9B9A97]">右侧暂无内容</span>}
        />
        <div
          className="mt-3 text-[11px] text-[#B0AEA8]"
          data-testid={workbenchSelectors.supportedWritebackSummary}
        >
          支持直接写回：DOCX、PPTX、XLSX、PNG、JPEG、WebP 和 UTF-8 文本
        </div>
      </div>
    </div>
  </div>
)

const getParentPath = (filePath: string): string => {
  const normalized = filePath.replace(/[/\\]+$/, '')
  const separatorIndex = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))
  return separatorIndex > 0 ? normalized.slice(0, separatorIndex) : filePath
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
  onOpenPath: (filePath: string) => Promise<boolean>
  onRevealPath: (filePath: string) => Promise<void>
  onRevert?: () => void
  explorerOpen?: boolean
  onToggleExplorer?: () => void
  displayMode?: DocumentDisplayMode
  onSwitchDisplayMode?: () => void
  showStaleExternalApplicationHint?: boolean
  onInfoMessage: (content: string) => void
}

export const WorkbenchDocumentPreviewPanelBase: React.FC<WorkbenchDocumentPreviewPanelProps> = ({
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
  onToggleExplorer,
  displayMode = 'preview',
  onSwitchDisplayMode,
  showStaleExternalApplicationHint = false,
  onInfoMessage
}) => {
  const [openWithApplications, setOpenWithApplications] = useState<OpenWithApplication[]>([])
  const [openWithLoading, setOpenWithLoading] = useState(false)
  const [openWithError, setOpenWithError] = useState<string | null>(null)
  const isDeletedCreatedFile = mode === 'edit' && status === 'reverted' && operation === 'created'
  const revealPath = isDeletedCreatedFile ? getParentPath(filePath) : filePath
  const openTitle = isDeletedCreatedFile ? '文件已删除，不能打开' : '系统默认打开'
  const revertTitle =
    status === 'reverted'
      ? isDeletedCreatedFile
        ? '已回退，文件已删除'
        : '已回退，不能重复操作'
      : '回退本次修改'
  const statusBadgeLabel =
    status === 'reverted' ? (operation === 'created' ? '已删除' : '已回退') : null
  const showReviewActions = mode === 'edit' && (!onSwitchDisplayMode || displayMode === 'review')
  const defaultApplication = openWithApplications.find((application) => application.isDefault)
  const openWithLabel = defaultApplication?.name || '系统默认打开'
  const showWpsOpenWithHint = shouldShowWpsOpenWithHint(filePath, openWithApplications)
  const showExternalApplicationHint = (): void => {
    if (showStaleExternalApplicationHint) {
      onInfoMessage('如果外部应用仍显示旧内容，请关闭该文档后重新打开。')
    }
  }

  const loadOpenWithApplications = async (): Promise<void> => {
    if (
      !canOpen ||
      isDeletedCreatedFile ||
      typeof window.api.listOpenWithApplications !== 'function'
    ) {
      return
    }
    setOpenWithLoading(true)
    setOpenWithError(null)
    try {
      const response = await window.api.listOpenWithApplications({ filePath })
      if (!response.success) {
        setOpenWithApplications([])
        setOpenWithError(response.error || '无法获取可用应用')
        return
      }
      setOpenWithApplications(response.applications.slice(0, 5))
    } catch (error) {
      setOpenWithApplications([])
      setOpenWithError(error instanceof Error ? error.message : '无法获取可用应用')
    } finally {
      setOpenWithLoading(false)
    }
  }

  useEffect(() => {
    setOpenWithApplications([])
    setOpenWithError(null)
    if (canOpen && !isDeletedCreatedFile) void loadOpenWithApplications()
    // The file path is the native association query key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, canOpen, isDeletedCreatedFile])

  const openWithApplication = async (application: OpenWithApplication): Promise<void> => {
    try {
      const response = await window.api.openFileWithApplication({
        filePath,
        applicationId: application.id
      })
      if (!response.success) {
        setOpenWithError(response.error || '打开应用失败')
        message.error(response.error || '打开应用失败')
        return
      }
      showExternalApplicationHint()
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '打开应用失败'
      setOpenWithError(errorMessage)
      message.error(errorMessage)
    }
  }

  const openWithApplicationItems: MenuProps['items'] =
    openWithApplications.length > 0
      ? openWithApplications.map((application) => ({
          key: application.id,
          icon: application.iconDataUrl ? (
            <img src={application.iconDataUrl} alt="" className="h-5 w-5 shrink-0 object-contain" />
          ) : (
            <HiArrowTopRightOnSquare className="h-4 w-4 text-[#91918E]" />
          ),
          label: (
            <span
              className="flex min-w-0 flex-1 items-center gap-3"
              data-testid={`${workbenchSelectors.openWithApplicationPrefix}-${application.id}`}
            >
              <span className="min-w-0 flex-1 truncate">{application.name}</span>
              {application.isDefault ? (
                <span className="shrink-0 text-[11px] text-[#9B9A97]">默认</span>
              ) : null}
            </span>
          )
        }))
      : [
          {
            key: 'empty',
            disabled: true,
            label: openWithLoading ? '正在获取可用应用…' : openWithError || '没有可用的应用'
          }
        ]
  const openWithItems: MenuProps['items'] = [
    ...(openWithApplicationItems || []),
    { type: 'divider' },
    {
      key: 'reveal-containing-folder',
      label: '打开所在文件夹'
    }
  ]

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      data-testid={testId}
      data-file-change-status={mode === 'edit' ? status : undefined}
    >
      <div
        className="flex h-11 shrink-0 items-center gap-2 border-b border-[#EEEEEC] bg-white px-3"
        data-testid={workbenchSelectors.documentToolbar}
      >
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
                {onSwitchDisplayMode ? (
                  <span className="inline-flex shrink-0 items-center gap-0.5">
                    <span
                      className="inline-flex h-5 items-center rounded-[4px] bg-[#F1F1EF] px-1.5 text-[11px] font-medium text-[#57554F]"
                      data-testid={workbenchSelectors.documentModeTag}
                    >
                      {displayMode === 'review' ? '审核' : '预览'}
                    </span>
                    <Tooltip title={displayMode === 'review' ? '切换到预览模式' : '切换到审核模式'}>
                      <Button
                        type="text"
                        size="small"
                        aria-label={displayMode === 'review' ? '切换到预览模式' : '切换到审核模式'}
                        icon={<HiArrowsRightLeft className="h-3.5 w-3.5" />}
                        className="!h-6 !w-6 !min-w-6 !rounded-[4px] !p-0 !text-[#91918E] hover:!bg-[#F4F4F2] hover:!text-[#37352F]"
                        data-testid={workbenchSelectors.documentModeToggle}
                        onClick={onSwitchDisplayMode}
                      />
                    </Tooltip>
                  </span>
                ) : null}
                {showReviewActions ? (
                  <>
                    <ChangeCountBadges insertCount={insertCount} deleteCount={deleteCount} />
                    {statusBadgeLabel ? (
                      <span className="inline-flex h-5 shrink-0 items-center rounded-[4px] bg-[#F4F4F2] px-1.5 text-[11px] font-medium text-[#787774]">
                        {statusBadgeLabel}
                      </span>
                    ) : null}
                  </>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {showWpsOpenWithHint ? (
            <Tooltip title={WPS_OPEN_WITH_HINT} placement="bottom">
              <button
                type="button"
                className="flex h-8 w-7 shrink-0 cursor-help items-center justify-center text-[#91918E] transition-colors hover:text-[#37352F]"
                aria-label={WPS_OPEN_WITH_HINT}
                data-testid={workbenchSelectors.wpsOpenWithHint}
              >
                <HiOutlineQuestionMarkCircle className="h-4 w-4" />
              </button>
            </Tooltip>
          ) : null}
          <Dropdown
            trigger={['click']}
            placement="bottomRight"
            overlayClassName="workbench-open-with-menu"
            menu={{
              items: openWithItems,
              onClick: ({ key }) => {
                if (key === 'reveal-containing-folder') {
                  void onRevealPath(revealPath)
                  return
                }
                const application = openWithApplications.find((item) => item.id === key)
                if (application) void openWithApplication(application)
              }
            }}
            onOpenChange={(open) => {
              if (open && openWithApplications.length === 0 && !openWithLoading) {
                void loadOpenWithApplications()
              }
            }}
          >
            <div
              className="flex h-8 shrink-0 items-stretch overflow-hidden rounded-[6px] border border-[#E7E5E0] bg-[#FBFBFA] shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
              data-testid={workbenchSelectors.openWithMenu}
            >
              <Button
                type="text"
                size="small"
                aria-label={openTitle}
                icon={
                  defaultApplication?.iconDataUrl ? (
                    <img
                      src={defaultApplication.iconDataUrl}
                      alt=""
                      className="h-4 w-4 object-contain"
                    />
                  ) : (
                    <HiArrowTopRightOnSquare className="h-4 w-4" />
                  )
                }
                className="!h-full !rounded-none !px-2.5 !text-[#37352F] hover:!bg-[#F1F1EF] disabled:!text-[#C9C7C2]"
                data-testid={workbenchSelectors.openWithButton}
                disabled={!canOpen || isDeletedCreatedFile}
                onClick={(event) => {
                  event.stopPropagation()
                  if (!canOpen || isDeletedCreatedFile) return
                  if (defaultApplication) {
                    void openWithApplication(defaultApplication)
                  } else {
                    void onOpenPath(filePath).then((opened) => {
                      if (opened) showExternalApplicationHint()
                    })
                  }
                }}
              >
                <span className="max-w-[104px] truncate text-[12px]">{openWithLabel}</span>
              </Button>
              <Button
                type="text"
                size="small"
                aria-label="选择打开应用"
                icon={<HiChevronDown className="h-3.5 w-3.5" />}
                className="!h-full !rounded-none !border-l !border-l-[#E7E5E0] !px-1.5 !text-[#787774] hover:!bg-[#F1F1EF] disabled:!text-[#C9C7C2]"
                data-testid={workbenchSelectors.applyOpenSystemButton}
              />
            </div>
          </Dropdown>
          {showReviewActions ? (
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
          {onToggleExplorer ? (
            <Tooltip title={explorerOpen ? '收起文件列表' : '展开文件列表'}>
              <Button
                type="text"
                size="small"
                aria-label={explorerOpen ? '收起文件列表' : '展开文件列表'}
                aria-pressed={explorerOpen}
                icon={<FileIcon kind="directory" expanded={explorerOpen} className="h-4 w-4" />}
                className={`!h-8 !w-8 !rounded-[6px] !border !p-0 !text-[#787774] hover:!bg-[#F4F4F2] hover:!text-[#37352F] ${
                  explorerOpen
                    ? '!border-[#D9D8D4] !bg-[#F1F1EF] !text-[#37352F]'
                    : '!border-transparent !bg-transparent'
                }`}
                data-testid={workbenchSelectors.workspaceExplorerToggle}
                data-icon="folder"
                onClick={onToggleExplorer}
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
  previous.backTarget === next.backTarget &&
  previous.displayMode === next.displayMode &&
  previous.onSwitchDisplayMode === next.onSwitchDisplayMode &&
  previous.explorerOpen === next.explorerOpen

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
  workspaceLoadState,
  onOpenWorkspaceSettings,
  onReloadWorkspaces,
  fileChangeRecords,
  partnerFileChangeRecords,
  onRevertApply,
  onBackToPanelState,
  onOpenPath,
  onRevealPath,
  onActivateTab,
  onCloseTab,
  onAddFileTab,
  onAddBrowserTab,
  onCollapse,
  onBrowserStateChange,
  onOpenWorkspaceFile,
  onWorkspaceFileRenamed,
  onOpenWorkspaceChange,
  isAiRunActive,
  onSuccessMessage,
  onInfoMessage,
  browserPresentationEnabled,
  browserTransitionImage
}) => {
  const [explorerOpen, setExplorerOpen] = useState(state.kind === 'file_launcher')
  const [explorerMode, setExplorerMode] = useState<WorkspaceFileExplorerMode>(
    state.kind === 'apply_workspace' ? 'changed' : 'all'
  )
  const [explorerReloadToken, setExplorerReloadToken] = useState(0)
  const [documentDisplayMode, setDocumentDisplayMode] = useState<DocumentDisplayMode>('review')
  const [previewRevision, setPreviewRevision] = useState(0)
  const [editableKind, setEditableKind] = useState<EditableTextKind>(null)
  const aiRunActiveRef = React.useRef(isAiRunActive)
  const previousAiRunActiveRef = React.useRef(isAiRunActive)
  const explorerNavigationRef = React.useRef(false)
  const previousExplorerOpenRef = React.useRef(explorerOpen)
  const suppressExternalNoticeUntilRef = React.useRef(isAiRunActive ? Number.POSITIVE_INFINITY : 0)
  const floatingExplorer = state.kind === 'file_preview' || state.kind === 'apply_workspace'
  const hasWorkspace = Boolean(selectedWorkspace?.root_path)
  const bumpExplorerReload = React.useCallback((): void => {
    setExplorerReloadToken((current) => current + 1)
  }, [])
  const activeEditableFile =
    state.kind === 'file_preview' && !state.file.isDirectory
      ? { path: state.file.path, fileName: state.file.fileName }
      : state.kind === 'apply_workspace' &&
          documentDisplayMode === 'preview' &&
          activeApplyRecord &&
          canSwitchDocumentDisplayMode(activeApplyRecord)
        ? { path: activeApplyRecord.path, fileName: activeApplyRecord.fileName }
        : null
  useEffect(() => {
    const path = activeEditableFile?.path
    const fileName = activeEditableFile?.fileName
    if (!path || !fileName) {
      setEditableKind(null)
      return
    }
    // 已知扩展名先同步标记，避免先只读预览再切编辑器造成空白闪一下
    const registered = resolveRegisteredPreviewType(fileName)
    if (registered === 'md') {
      setEditableKind('markdown')
      return
    }
    if (registered === 'txt') {
      setEditableKind('plain-text')
      return
    }
    let cancelled = false
    void classifyEditableTextKind(path, fileName)
      .then((kind) => {
        if (!cancelled) setEditableKind(kind)
      })
      .catch(() => {
        if (!cancelled) setEditableKind(null)
      })
    return () => {
      cancelled = true
    }
  }, [activeEditableFile?.path, activeEditableFile?.fileName])
  // 可编辑文本由编辑器自行处理外部变更；面板级 watch 仅覆盖不可编辑预览（docx/ppt/excel 等）
  const previewWatchPath =
    activeEditableFile && editableKind === null ? activeEditableFile.path : null
  useEffect(() => {
    if (state.kind === 'file_launcher') {
      setExplorerOpen(true)
      setExplorerMode('all')
      bumpExplorerReload()
    }
    if (state.kind === 'apply_workspace') {
      if (!explorerNavigationRef.current) setExplorerOpen(false)
      setExplorerMode('changed')
    }
    explorerNavigationRef.current = false
  }, [bumpExplorerReload, state.kind])
  useEffect(() => {
    if (explorerOpen && !previousExplorerOpenRef.current) {
      bumpExplorerReload()
    }
    previousExplorerOpenRef.current = explorerOpen
  }, [bumpExplorerReload, explorerOpen])
  useEffect(
    () => setDocumentDisplayMode(getDefaultDocumentDisplayMode(activeApplyRecord?.status)),
    [activeApplyRecord?.id, activeApplyRecord?.status]
  )
  useEffect(() => {
    aiRunActiveRef.current = isAiRunActive
    if (isAiRunActive) {
      suppressExternalNoticeUntilRef.current = Number.POSITIVE_INFINITY
    } else if (previousAiRunActiveRef.current) {
      suppressExternalNoticeUntilRef.current = Date.now() + 1_500
      if (explorerOpen) bumpExplorerReload()
    }
    previousAiRunActiveRef.current = isAiRunActive
  }, [bumpExplorerReload, explorerOpen, isAiRunActive])
  useEffect(() => {
    if (!previewWatchPath) return () => undefined
    let disposed = false
    let watchId: string | null = null

    const refreshPreview = (): void => {
      if (disposed) return
      setPreviewRevision((current) => current + 1)
      const noticeSuppressed =
        aiRunActiveRef.current || Date.now() <= suppressExternalNoticeUntilRef.current
      if (!noticeSuppressed) {
        void window.api.fileExists(previewWatchPath).then((exists) => {
          if (exists && !disposed) onSuccessMessage('检测到当前文件被外部修改，已自动刷新')
        })
      }
    }

    const unsubscribe = window.api.onFileWatchChange((event) => {
      if (event.watchId === watchId) refreshPreview()
    })
    const startWatch = async (): Promise<void> => {
      const response = await window.api.fileWatchStart({ filePath: previewWatchPath })
      if (!response.success || !response.watchId) return
      if (disposed) {
        await window.api.fileWatchStop({ watchId: response.watchId }).catch(() => undefined)
        return
      }
      watchId = response.watchId
    }
    const checkOnFocus = (): void => {
      if (!watchId) return
      void window.api.fileWatchCheck({ watchId }).then((response) => {
        if (response.success && response.changed) refreshPreview()
      })
    }

    void startWatch()
    window.addEventListener('focus', checkOnFocus)
    const checkOnVisibility = (): void => {
      if (!document.hidden) checkOnFocus()
    }
    document.addEventListener('visibilitychange', checkOnVisibility)
    return () => {
      disposed = true
      unsubscribe()
      window.removeEventListener('focus', checkOnFocus)
      document.removeEventListener('visibilitychange', checkOnVisibility)
      if (watchId) void window.api.fileWatchStop({ watchId }).catch(() => undefined)
    }
  }, [onSuccessMessage, previewWatchPath])
  useEffect(() => {
    if (!explorerOpen || !floatingExplorer) return () => undefined
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.defaultPrevented) setExplorerOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [explorerOpen, floatingExplorer])
  const previewDocuments = useMemo<FileRenderDocument[]>(
    () =>
      state.kind === 'file_preview'
        ? [
            {
              filePath: state.file.path,
              fileName: state.file.fileName,
              contentRevision: previewRevision,
              editable: editableKind !== null,
              metadata: {
                pageNumber: state.file.pageNumber,
                allowDocumentSelection: true,
                docxOverview: 'references'
              }
            }
          ]
        : [],
    [previewRevision, state, editableKind]
  )
  const previewChangeRecord = useMemo(() => {
    if (state.kind !== 'file_preview' || state.file.isDirectory) return null
    const record = findLatestFileChangeForPath(partnerFileChangeRecords, state.file.path)
    return canSwitchDocumentDisplayMode(record) ? record : null
  }, [partnerFileChangeRecords, state])
  const hasDedicatedPreview = Boolean(activeApplyRecord?.previewPath)
  const canSwitchDisplayMode = canSwitchDocumentDisplayMode(activeApplyRecord)
  const applyDocuments = useMemo<FileRenderDocument[]>(() => {
    if (!activeApplyRecord) return []
    if (!canSwitchDocumentDisplayMode(activeApplyRecord)) {
      if (
        activeApplyRecord.status !== 'applied' ||
        (activeApplyRecord.operation !== 'created' && activeApplyRecord.capability !== 'image')
      ) {
        return []
      }
      return [
        {
          filePath:
            activeApplyRecord.capability === 'image'
              ? activeApplyRecord.afterSnapshotPath || activeApplyRecord.path
              : documentDisplayMode === 'preview'
                ? activeApplyRecord.path
                : activeApplyRecord.previewPath || '',
          fileName: activeApplyRecord.fileName
        }
      ]
    }
    const filePath = getApplyDocumentPath(activeApplyRecord, documentDisplayMode)
    if (!filePath) return []
    const editable =
      documentDisplayMode === 'preview' &&
      editableKind !== null &&
      filePath === activeApplyRecord.path
    return [
      {
        filePath,
        fileName: activeApplyRecord.fileName,
        contentRevision: documentDisplayMode === 'preview' ? previewRevision : undefined,
        editable,
        metadata: {
          docxOverview: documentDisplayMode === 'preview' ? 'references' : 'changes',
          excelReview: activeApplyRecord.capability === 'excel' && documentDisplayMode === 'review',
          allowDocumentSelection:
            documentDisplayMode === 'preview' && filePath === activeApplyRecord.path
        }
      }
    ]
  }, [activeApplyRecord, documentDisplayMode, editableKind, previewRevision])
  const applyContent = useMemo(
    () =>
      activeApplyRecord &&
      documentDisplayMode === 'review' &&
      activeApplyRecord.capability !== 'image' &&
      !activeApplyRecord.previewPath ? (
        <div className="flex h-full items-center justify-center text-sm text-[#B3261E]">
          审核产物缺失或格式不支持
        </div>
      ) : activeApplyRecord?.capability === 'ppt' &&
        activeApplyRecord.previewPath &&
        documentDisplayMode === 'review' ? (
        <PptDiffViewer record={activeApplyRecord} />
      ) : activeApplyRecord?.capability === 'text_file' &&
        activeApplyRecord.previewPath &&
        documentDisplayMode === 'review' ? (
        <TextFileDiffViewer previewPath={activeApplyRecord.previewPath} />
      ) : undefined,
    [activeApplyRecord, documentDisplayMode]
  )
  const applyEmptyText =
    activeApplyRecord?.operation === 'created'
      ? '本次新建了该文件，暂时无法在应用内预览。'
      : hasDedicatedPreview
        ? '审核内容加载失败，可以使用系统应用打开文件查看。'
        : '文件暂时无法在应用内预览。'
  const fallbackChangeContent =
    activeApplyRecord &&
    (activeApplyRecord.operation === 'renamed' ||
      activeApplyRecord.operation === 'deleted' ||
      (!canSwitchDisplayMode &&
        activeApplyRecord.capability !== 'image' &&
        (activeApplyRecord.status === 'reverted' || activeApplyRecord.operation !== 'created'))) ? (
      <FileChangeNotice record={activeApplyRecord} />
    ) : undefined
  const activePath =
    state.kind === 'file_preview'
      ? state.file.path
      : state.kind === 'apply_workspace'
        ? activeApplyRecord?.path
        : null
  const activePathRef = React.useRef(activePath)
  React.useLayoutEffect(() => {
    activePathRef.current = activePath
  }, [activePath])
  const openWorkspaceChangeFromExplorer = (change: AiFileChangeRecord): void => {
    setDocumentDisplayMode(getDefaultDocumentDisplayMode(change.status))
    explorerNavigationRef.current = state.kind !== 'apply_workspace'
    onOpenWorkspaceChange(change.id)
  }
  const handleExplorerFileChanged = (filePath: string): void => {
    if (filePath === activePathRef.current) setPreviewRevision((current) => current + 1)
  }
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
        onCollapse={onCollapse}
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="relative flex h-full min-h-0">
          <div className="min-w-0 flex-1 overflow-hidden">
            {state.kind === 'empty' ? <WorkbenchEmptyPanel /> : null}
            {state.kind === 'file_launcher' ? (
              hasWorkspace ? (
                <div className="flex h-full items-center justify-center text-center">
                  <div>
                    <FileIcon
                      kind="directory"
                      expanded
                      className="mx-auto h-10 w-10 text-[#91918E]"
                    />
                    <div className="mt-4 text-[18px] font-semibold text-[#37352F]">打开文件</div>
                    <div className="mt-2 text-sm text-[#91918E]">从右侧工作区文件列表中选择</div>
                  </div>
                </div>
              ) : (
                <WorkspaceFilesEmptyState
                  loadState={workspaceLoadState}
                  onOpenSettings={onOpenWorkspaceSettings}
                  onRetry={onReloadWorkspaces}
                />
              )
            ) : null}
            {state.kind === 'file_preview' ? (
              <WorkbenchDocumentPreviewPanel
                filePath={state.file.path}
                documents={previewDocuments}
                mode={previewChangeRecord ? 'edit' : 'preview'}
                status={previewChangeRecord?.status}
                displayMode="preview"
                onSwitchDisplayMode={
                  previewChangeRecord
                    ? () => onOpenWorkspaceChange(previewChangeRecord.id)
                    : undefined
                }
                canOpen={!state.file.isDirectory}
                workspaces={workspaces}
                fallbackWorkspaceName={fallbackWorkspaceName}
                backTarget={state.backTarget}
                onBackToPanelState={onBackToPanelState}
                onOpenPath={onOpenPath}
                onRevealPath={onRevealPath}
                onInfoMessage={onInfoMessage}
                explorerOpen={explorerOpen}
                onToggleExplorer={() => setExplorerOpen((current) => !current)}
              />
            ) : null}
            {state.kind === 'apply_workspace' ? (
              activeApplyRecord ? (
                <WorkbenchDocumentPreviewPanel
                  filePath={activeApplyRecord.path}
                  documents={applyDocuments}
                  content={fallbackChangeContent || applyContent}
                  mode="edit"
                  status={activeApplyRecord.status}
                  operation={activeApplyRecord.operation}
                  insertCount={activeApplyRecord.insertCount}
                  deleteCount={activeApplyRecord.deleteCount}
                  testId={workbenchSelectors.applyPanel}
                  loading={applyLoading}
                  reverting={applyReverting}
                  canRevert={activeApplyRecord.status === 'applied' && !applyReverting}
                  errorMessage={
                    activeApplyRecord.status === 'failed' ? activeApplyRecord.error : null
                  }
                  emptyText={applyEmptyText}
                  workspaces={workspaces}
                  fallbackWorkspaceName={fallbackWorkspaceName}
                  onBackToPanelState={onBackToPanelState}
                  onOpenPath={onOpenPath}
                  onRevealPath={onRevealPath}
                  onInfoMessage={onInfoMessage}
                  onRevert={onRevertApply}
                  displayMode={documentDisplayMode}
                  onSwitchDisplayMode={
                    canSwitchDocumentDisplayMode(activeApplyRecord)
                      ? () =>
                          setDocumentDisplayMode((current) =>
                            current === 'review' ? 'preview' : 'review'
                          )
                      : undefined
                  }
                  explorerOpen={explorerOpen}
                  onToggleExplorer={() => setExplorerOpen((current) => !current)}
                  showStaleExternalApplicationHint={activeApplyRecord.status === 'applied'}
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
                presentationEnabled={browserPresentationEnabled}
                transitionImage={
                  browserTransitionImage?.tabId === state.browserTabId
                    ? browserTransitionImage.dataUrl
                    : null
                }
                onStateChange={onBrowserStateChange}
              />
            ) : null}
          </div>
          {floatingExplorer && explorerOpen ? (
            <button
              type="button"
              aria-label="关闭文件列表"
              className="absolute inset-x-0 bottom-0 top-11 z-10 cursor-default bg-transparent"
              data-testid={workbenchSelectors.workspaceExplorerBackdrop}
              onClick={() => setExplorerOpen(false)}
            />
          ) : null}
          {explorerOpen &&
          (floatingExplorer || (state.kind === 'file_launcher' && hasWorkspace)) ? (
            <div
              key="workspace-file-explorer"
              className={
                floatingExplorer
                  ? 'absolute bottom-0 right-0 top-11 z-20 w-[300px] max-w-[85%] overflow-hidden bg-white shadow-[-8px_8px_24px_rgba(0,0,0,0.12)]'
                  : 'w-[min(38%,300px)] min-w-[240px] shrink-0'
              }
              data-testid={
                floatingExplorer ? workbenchSelectors.workspaceExplorerOverlay : undefined
              }
            >
              <WorkspaceFileExplorer
                workspace={selectedWorkspace}
                workspaceLoadState={workspaceLoadState}
                onOpenWorkspaceSettings={onOpenWorkspaceSettings}
                onReloadWorkspaces={onReloadWorkspaces}
                changeRecords={fileChangeRecords}
                mode={explorerMode}
                reloadToken={explorerReloadToken}
                liveRefreshEnabled={explorerOpen}
                onModeChange={setExplorerMode}
                onOpenFile={(entry) => onOpenWorkspaceFile(entry.absolute_path, entry.name)}
                onOpenChange={openWorkspaceChangeFromExplorer}
                onFileChanged={handleExplorerFileChanged}
                onFileRenamed={onWorkspaceFileRenamed}
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
  previous.workspaceLoadState === next.workspaceLoadState &&
  previous.onOpenWorkspaceSettings === next.onOpenWorkspaceSettings &&
  previous.onReloadWorkspaces === next.onReloadWorkspaces &&
  previous.onWorkspaceFileRenamed === next.onWorkspaceFileRenamed &&
  previous.fileChangeRecords === next.fileChangeRecords &&
  previous.partnerFileChangeRecords === next.partnerFileChangeRecords &&
  previous.isAiRunActive === next.isAiRunActive &&
  previous.onSuccessMessage === next.onSuccessMessage &&
  previous.onInfoMessage === next.onInfoMessage &&
  previous.browserPresentationEnabled === next.browserPresentationEnabled &&
  previous.browserTransitionImage === next.browserTransitionImage

const WorkbenchContentPanel = React.memo(WorkbenchContentPanelBase, areContentPanelPropsEqual)

export default WorkbenchContentPanel
