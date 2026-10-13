import FileIcon from '../FileIcon'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { App as AntdApp, Button, Empty, Modal, Popover, Tabs, Tooltip, message } from 'antd'
import { useNavigate } from 'react-router-dom'
import type {
  WorkspaceIndexJobRecord,
  WorkspaceListItem,
  WorkspaceTreeEntry,
  WorkspaceDirectoryListResponse
} from '../../../../shared/types'
import {
  HiArrowPath,
  HiChevronDown,
  HiChevronRight,
  HiCircleStack,
  HiOutlineFolderPlus,
  HiOutlineQuestionMarkCircle,
  HiOutlineTrash
} from 'react-icons/hi2'
import { importSelectors, settingsSelectors } from '../../testing/selectors'
import { normalizeUserFacingError } from '../../utils/userFacingError'
import WebSourcesSettingsPanel from './WebSourcesSettingsPanel'
import WorkspaceIndexJobProgress from './WorkspaceIndexJobProgress'
import { KnowledgeIndexSpeedControl } from './KnowledgeIndexSpeedControl'
import IndexPrepareCancelModal from './IndexPrepareCancelModal'
import { getTreeEntryStatusMeta } from './utils/workspace'
import { prepareWorkspacesSequentially } from '../../../../shared/prepareWorkspacesSequentially'
import { beginPrepareHeld, endPrepareHeld } from './prepareHeld'
import type { WorkspaceJobMap } from './types'

type WorkspaceDirectoryMap = Record<string, Record<string, WorkspaceTreeEntry[]>>
type WorkspaceDirectoryLoadingMap = Record<string, Record<string, boolean>>
type WorkspaceDirectoryErrorMap = Record<string, Record<string, string | undefined>>

const HELD_FILE_PREPARE_JOB: WorkspaceIndexJobRecord = {
  id: 'held-file-prepare',
  workspace_id: '',
  source_kind: 'file',
  action: 'prepare',
  status: 'running',
  phase: 'index',
  step_index: 1,
  step_total: 1,
  total_count: 0,
  processed_count: 0,
  failed_count: 0,
  target_ids: [],
  started_at: 0,
  updated_at: 0
}

const getRootDisplayName = (workspace: WorkspaceListItem): string =>
  workspace.root_path.split(/[/\\]/).filter(Boolean).pop() || workspace.root_path

const WorkspaceSettingsPanel: React.FC = () => {
  const navigate = useNavigate()
  const { modal } = AntdApp.useApp()
  const [workspaces, setWorkspaces] = useState<WorkspaceListItem[]>([])
  const [workspaceDirectories, setWorkspaceDirectories] = useState<WorkspaceDirectoryMap>({})
  const [workspaceDirectoryLoading, setWorkspaceDirectoryLoading] =
    useState<WorkspaceDirectoryLoadingMap>({})
  const [workspaceDirectoryErrors, setWorkspaceDirectoryErrors] =
    useState<WorkspaceDirectoryErrorMap>({})
  const [workspaceTreeSummaries, setWorkspaceTreeSummaries] = useState<
    Record<string, NonNullable<WorkspaceDirectoryListResponse['summary']>>
  >({})
  const [workspaceExpandedKeys, setWorkspaceExpandedKeys] = useState<Record<string, string[]>>({})
  const [collapsedRootIds, setCollapsedRootIds] = useState<string[]>([])
  const [workspaceIndexJobs, setWorkspaceIndexJobs] = useState<WorkspaceJobMap>({})
  const [workspaceLoading, setWorkspaceLoading] = useState(false)
  const [workspaceDirectoryReloadVersion, setWorkspaceDirectoryReloadVersion] = useState(0)
  const [selectedTabKey, setSelectedTabKey] = useState<'files' | 'web'>('files')
  const [deleteWorkspaceId, setDeleteWorkspaceId] = useState<string | null>(null)
  const [hasVectorModel, setHasVectorModel] = useState<boolean | null>(null)
  const [webSourceCount, setWebSourceCount] = useState(0)
  const [filePrepareCancelling, setFilePrepareCancelling] = useState(false)
  const [fileCancelModalOpen, setFileCancelModalOpen] = useState(false)
  const [filePrepareHeld, setFilePrepareHeld] = useState(false)
  const filePrepareSessionRef = useRef({ completed: 0, startedIds: new Set<string>() })
  const lastPrepareJobRef = useRef<WorkspaceIndexJobRecord | undefined>(undefined)
  const workspaceDirectoryRequestIds = useRef<Record<string, Record<string, number>>>({})
  const workspaceDirectoriesRef = useRef<WorkspaceDirectoryMap>({})
  const workspacesRef = useRef(workspaces)
  workspaceDirectoriesRef.current = workspaceDirectories
  workspacesRef.current = workspaces

  const loadWorkspaceDirectory = useCallback(
    async (workspaceId: string, relativePath: string): Promise<void> => {
      const requestId = (workspaceDirectoryRequestIds.current[workspaceId]?.[relativePath] || 0) + 1
      workspaceDirectoryRequestIds.current = {
        ...workspaceDirectoryRequestIds.current,
        [workspaceId]: {
          ...workspaceDirectoryRequestIds.current[workspaceId],
          [relativePath]: requestId
        }
      }
      const isLatestRequest = (): boolean =>
        workspaceDirectoryRequestIds.current[workspaceId]?.[relativePath] === requestId
      const existingItems = workspaceDirectoriesRef.current[workspaceId]?.[relativePath]
      if (!existingItems) {
        setWorkspaceDirectoryLoading((previous) => ({
          ...previous,
          [workspaceId]: { ...previous[workspaceId], [relativePath]: true }
        }))
      }
      setWorkspaceDirectoryErrors((previous) => ({
        ...previous,
        [workspaceId]: { ...previous[workspaceId], [relativePath]: undefined }
      }))
      try {
        const response = await window.api.workspaceDirectoryList({ workspaceId, relativePath })
        if (response.error) throw new Error(response.error)
        if (!isLatestRequest()) return
        setWorkspaceDirectories((previous) => ({
          ...previous,
          [workspaceId]: { ...previous[workspaceId], [relativePath]: response.items }
        }))
        if (response.summary) {
          setWorkspaceTreeSummaries((previous) => ({
            ...previous,
            [workspaceId]: response.summary as NonNullable<
              WorkspaceDirectoryListResponse['summary']
            >
          }))
        }
      } catch (error) {
        if (!isLatestRequest()) return
        setWorkspaceDirectoryErrors((previous) => ({
          ...previous,
          [workspaceId]: {
            ...previous[workspaceId],
            [relativePath]: error instanceof Error ? error.message : String(error)
          }
        }))
      } finally {
        if (isLatestRequest()) {
          setWorkspaceDirectoryLoading((previous) => ({
            ...previous,
            [workspaceId]: { ...previous[workspaceId], [relativePath]: false }
          }))
        }
      }
    },
    []
  )

  const refreshWorkspaceDirectories = useCallback(
    (workspaceId: string): void => {
      const cachedPaths = Object.keys(workspaceDirectoriesRef.current[workspaceId] || {})
      const relativePaths = cachedPaths.length > 0 ? cachedPaths : ['']
      if (!relativePaths.includes('')) relativePaths.unshift('')
      relativePaths.forEach((relativePath) => {
        void loadWorkspaceDirectory(workspaceId, relativePath)
      })
    },
    [loadWorkspaceDirectory]
  )

  const refreshVisibleWorkspaceTree = useCallback(async (): Promise<void> => {
    setWorkspaceLoading(true)
    try {
      const workspaceResponse = await window.api.workspaceList()
      setWorkspaces(workspaceResponse.items)
      workspaceResponse.items.forEach((workspace) => {
        if (!workspace.root_path || workspace.root_kind === 'file') return
        refreshWorkspaceDirectories(workspace.id)
      })
    } catch (error) {
      console.error(error)
      message.error('刷新失败')
    } finally {
      setWorkspaceLoading(false)
    }
  }, [refreshWorkspaceDirectories])

  const loadWorkspaces = useCallback(async (options?: { focusRootId?: string }): Promise<void> => {
    setWorkspaceLoading(true)
    try {
      const workspaceResponse = await window.api.workspaceList()
      setWorkspaces(workspaceResponse.items)
      setWorkspaceDirectories({})
      setWorkspaceDirectoryLoading({})
      setWorkspaceDirectoryErrors({})
      setWorkspaceTreeSummaries({})
      setWorkspaceExpandedKeys({})
      setCollapsedRootIds(
        options?.focusRootId
          ? workspaceResponse.items
              .map((item) => item.id)
              .filter((id) => id !== options.focusRootId)
          : []
      )
      setWorkspaceDirectoryReloadVersion((value) => value + 1)
    } catch (error) {
      console.error(error)
      message.error('加载工作空间失败')
    } finally {
      setWorkspaceLoading(false)
    }
  }, [])

  const refreshWorkspaceList = useCallback(async (): Promise<void> => {
    setWorkspaceLoading(true)
    try {
      const workspaceResponse = await window.api.workspaceList()
      setWorkspaces(workspaceResponse.items)
    } catch (error) {
      console.error(error)
      message.error('加载工作空间失败')
    } finally {
      setWorkspaceLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadWorkspaces()
  }, [loadWorkspaces])

  useEffect(() => {
    void window.api
      .getModels()
      .then((models) => setHasVectorModel(models.some((model) => model.isDownloaded)))
      .catch(() => setHasVectorModel(false))
  }, [])

  useEffect(() => {
    const unsubscribe = window.api.sourceListRefresh(() => {
      void refreshWorkspaceList()
    })
    return () => {
      unsubscribe()
    }
  }, [refreshWorkspaceList])

  useEffect(() => {
    const handleProgress = (job: WorkspaceIndexJobRecord): void => {
      if (job.source_kind !== 'file') return
      setWorkspaceIndexJobs((previous) => ({
        ...previous,
        [job.workspace_id]: job.status === 'running' ? job : undefined
      }))
      if (job.status !== 'running') {
        workspacesRef.current.forEach((workspace) => {
          if (!workspace.root_path || workspace.root_kind === 'file') return
          refreshWorkspaceDirectories(workspace.id)
        })
      }
    }
    return window.api.onWorkspaceIndexJobProgress(handleProgress)
  }, [refreshWorkspaceDirectories])

  useEffect(() => {
    workspaces.forEach((workspace) => {
      void window.api
        .workspaceIndexJobGet({ workspaceId: workspace.id, sourceKind: 'file' })
        .then((response) => {
          if (!response.success) return
          setWorkspaceIndexJobs((previous) => {
            if (response.job?.status === 'running') {
              return { ...previous, [workspace.id]: response.job }
            }
            if (previous[workspace.id]?.status === 'running') return previous
            return { ...previous, [workspace.id]: undefined }
          })
        })
        .catch(console.error)
    })
  }, [workspaces])

  useEffect(() => {
    workspaces.forEach((workspace) => {
      if (!workspace.root_path || workspace.root_kind === 'file') return
      void loadWorkspaceDirectory(workspace.id, '')
    })
  }, [loadWorkspaceDirectory, workspaces, workspaceDirectoryReloadVersion])

  const summedSummary = useMemo(() => {
    const summaries = Object.values(workspaceTreeSummaries)
    if (summaries.length === 0) {
      return workspaces.reduce(
        (acc, workspace) => ({
          file_count: acc.file_count + workspace.file_count,
          indexed_file_count: acc.indexed_file_count,
          needs_index_count: acc.needs_index_count,
          failed_file_count: acc.failed_file_count
        }),
        { file_count: 0, indexed_file_count: 0, needs_index_count: 0, failed_file_count: 0 }
      )
    }
    return summaries.reduce(
      (acc, summary) => ({
        file_count: acc.file_count + summary.file_count,
        indexed_file_count: acc.indexed_file_count + summary.indexed_file_count,
        needs_index_count: acc.needs_index_count + summary.needs_index_count,
        failed_file_count: acc.failed_file_count + summary.failed_file_count
      }),
      { file_count: 0, indexed_file_count: 0, needs_index_count: 0, failed_file_count: 0 }
    )
  }, [workspaceTreeSummaries, workspaces])

  const actionableIndexCount = summedSummary.needs_index_count + summedSummary.failed_file_count
  const runningFileJob = useMemo(
    () => Object.values(workspaceIndexJobs).find((job) => job?.status === 'running'),
    [workspaceIndexJobs]
  )
  if (runningFileJob?.action === 'prepare') {
    lastPrepareJobRef.current = runningFileJob
  }
  const displayFileIndexJob = useMemo(() => {
    if (runningFileJob) return runningFileJob
    if (!filePrepareHeld) return undefined
    return lastPrepareJobRef.current
      ? { ...lastPrepareJobRef.current, status: 'running' as const }
      : HELD_FILE_PREPARE_JOB
  }, [filePrepareHeld, runningFileJob])

  useEffect(() => {
    if (runningFileJob?.action === 'prepare' || filePrepareHeld) return
    setFilePrepareCancelling(false)
    setFileCancelModalOpen(false)
  }, [filePrepareHeld, runningFileJob])

  const toggleWorkspaceDirectory = (workspaceId: string, entry: WorkspaceTreeEntry): void => {
    if (entry.kind !== 'directory') return
    const path = entry.relative_path
    const expanded = new Set(workspaceExpandedKeys[workspaceId] || [])
    if (expanded.has(path)) {
      expanded.delete(path)
    } else {
      expanded.add(path)
      if (
        !workspaceDirectories[workspaceId]?.[path] &&
        !workspaceDirectoryLoading[workspaceId]?.[path]
      ) {
        void loadWorkspaceDirectory(workspaceId, path)
      }
    }
    setWorkspaceExpandedKeys((previous) => ({
      ...previous,
      [workspaceId]: Array.from(expanded)
    }))
  }

  const renderWorkspaceEntries = (
    workspaceId: string,
    parentPath: string,
    depth: number
  ): React.ReactNode => {
    const entries = workspaceDirectories[workspaceId]?.[parentPath] || []
    const expanded = new Set(workspaceExpandedKeys[workspaceId] || [])
    const loading = workspaceDirectoryLoading[workspaceId]?.[parentPath] === true
    const error = workspaceDirectoryErrors[workspaceId]?.[parentPath]
    return (
      <div>
        {entries.map((entry) => {
          const isDirectory = entry.kind === 'directory'
          const isExpanded = expanded.has(entry.relative_path)
          const entryStatus = getTreeEntryStatusMeta(entry)
          const childLoading =
            workspaceDirectoryLoading[workspaceId]?.[entry.relative_path] === true
          return (
            <React.Fragment key={entry.id}>
              <button
                type="button"
                className="ant-tree-treenode flex min-h-[30px] w-full items-center gap-1.5 rounded-[4px] px-2 text-left text-[13px] text-[#37352F]"
                style={{ paddingLeft: 8 + depth * 18 }}
                onClick={() =>
                  isDirectory ? toggleWorkspaceDirectory(workspaceId, entry) : undefined
                }
              >
                <span className="ant-tree-switcher flex h-4 w-4 shrink-0 items-center justify-center text-[#91918E]">
                  {isDirectory ? isExpanded ? <HiChevronDown /> : <HiChevronRight /> : null}
                </span>
                <FileIcon
                  name={entry.name}
                  extension={entry.file_ext}
                  kind={isDirectory ? 'directory' : undefined}
                  expanded={isExpanded}
                />
                <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                {entryStatus ? (
                  <span
                    className={`shrink-0 rounded-[4px] border px-1.5 text-[10px] ${entryStatus.className}`}
                  >
                    {entryStatus.label}
                  </span>
                ) : null}
                {childLoading ? (
                  <HiArrowPath className="h-3.5 w-3.5 shrink-0 animate-spin text-[#91918E]" />
                ) : null}
              </button>
              {isDirectory && isExpanded
                ? renderWorkspaceEntries(workspaceId, entry.relative_path, depth + 1)
                : null}
            </React.Fragment>
          )
        })}
        {loading && entries.length === 0 ? (
          <div className="px-3 py-2 text-[12px] text-[#91918E]">正在读取…</div>
        ) : null}
        {error ? (
          <button
            type="button"
            className="px-3 py-2 text-[12px] text-[#B3261E]"
            onClick={() => void loadWorkspaceDirectory(workspaceId, parentPath)}
          >
            读取失败，点击重试
          </button>
        ) : null}
      </div>
    )
  }

  const formatQuotedPaths = (paths: string[]): string =>
    paths.map((item) => `「${item}」`).join('、')

  const showRootConflictModal = (input: {
    title: string
    content: string
    testId: string
  }): void => {
    // Native directory dialog steals focus; defer so the confirm modal actually appears.
    window.setTimeout(() => {
      modal.warning({
        title: input.title,
        content: input.content,
        okText: '知道了',
        centered: true,
        okButtonProps: {
          'data-testid': input.testId
        }
      })
    }, 50)
  }

  const toggleRootCollapsed = (workspaceId: string): void => {
    setCollapsedRootIds((previous) =>
      previous.includes(workspaceId)
        ? previous.filter((id) => id !== workspaceId)
        : [...previous, workspaceId]
    )
  }

  const handleAddRoot = async (): Promise<void> => {
    const selection = await window.api.pickDirectory()
    if (selection.error) {
      message.error(selection.error)
      return
    }
    if (selection.canceled || !selection.path) return
    const rootPath = selection.path.trim()
    const response = await window.api.workspaceCreate({ rootPath })
    if (response.conflict?.reason === 'exists') {
      showRootConflictModal({
        title: '目录已添加',
        content: '这个目录已经在文件地址里了，不用重复添加。',
        testId: importSelectors.workspaceRootConflictExistsOk
      })
      return
    }
    if (response.conflict?.reason === 'nested') {
      showRootConflictModal({
        title: '目录已包含',
        content: `所选目录已经包含在 ${formatQuotedPaths(response.conflict.existingPaths)} 内，不用重复添加。`,
        testId: importSelectors.workspaceRootConflictNestedOk
      })
      return
    }
    if (!response.success || !response.workspace) {
      message.error(normalizeUserFacingError(response.error, '添加地址失败'))
      return
    }
    message.success('目录已添加')
    await loadWorkspaces({ focusRootId: response.workspace.id })
  }

  const handleWorkspaceScanAll = async (): Promise<void> => {
    try {
      const results = await Promise.all(
        workspaces.map((workspace) => window.api.workspaceScan({ workspaceId: workspace.id }))
      )
      const failed = results.find((response) => !response.success)
      if (failed) {
        message.error(normalizeUserFacingError(failed.error, '检查更新失败'))
      }
    } catch (error) {
      console.error(error)
      message.error('检查更新失败')
    }
  }

  const handleWorkspacePrepareAll = async (): Promise<void> => {
    if (hasVectorModel !== true) {
      setFilePrepareHeld(false)
      message.warning('请先安装向量模型后再更新索引')
      return
    }
    const heldAt = beginPrepareHeld(setFilePrepareHeld)
    try {
      filePrepareSessionRef.current = { completed: 0, startedIds: new Set<string>() }
      await window.api.workspaceIndexPrepareSessionBegin({ sourceKind: 'file' })
      const results = await prepareWorkspacesSequentially(
        workspaces.map((workspace) => workspace.id),
        async (workspaceId) => {
          filePrepareSessionRef.current.startedIds.add(workspaceId)
          const response = await window.api.workspacePrepare({ workspaceId })
          if (
            response.job &&
            (response.job.status === 'succeeded' || response.job.status === 'failed')
          ) {
            filePrepareSessionRef.current.completed += response.job.processed_count
          }
          return response
        },
        (response) => !response.cancelled && response.job?.status !== 'cancelled'
      )
      const failed = results.find((response) => !response.success)
      if (failed) {
        message.error(normalizeUserFacingError(failed.error, '更新索引失败'))
      }
    } catch (error) {
      console.error(error)
      message.error('更新索引失败')
    } finally {
      await endPrepareHeld(setFilePrepareHeld, heldAt)
    }
  }

  const handleWorkspacePrepareButtonClick = (): void => {
    if (filePrepareCancelling) return
    if (runningFileJob?.action === 'prepare' || filePrepareHeld) {
      setFileCancelModalOpen(true)
      return
    }
    if (hasVectorModel !== true) {
      message.warning('请先安装向量模型后再更新索引')
      return
    }
    beginPrepareHeld(setFilePrepareHeld)
    void handleWorkspacePrepareAll()
  }

  const handleConfirmFilePrepareCancel = async (): Promise<void> => {
    setFileCancelModalOpen(false)
    const hasRunningPrepare = runningFileJob?.action === 'prepare' || filePrepareHeld
    if (hasRunningPrepare) setFilePrepareCancelling(true)
    try {
      const response = await window.api.workspaceIndexCancel({ sourceKind: 'file' })
      if (!response.success) {
        setFilePrepareCancelling(false)
        message.error(normalizeUserFacingError(response.error, '停止更新索引失败'))
      }
    } catch (error) {
      setFilePrepareCancelling(false)
      console.error(error)
      message.error('停止更新索引失败')
    }
  }

  const handleDeleteWorkspace = async (): Promise<void> => {
    if (!deleteWorkspaceId) return
    try {
      const response = await window.api.workspaceDelete(deleteWorkspaceId)
      if (!response.success) {
        message.error(normalizeUserFacingError(response.error, '移除失败'))
        return
      }
      message.success('已移除')
      setDeleteWorkspaceId(null)
      await loadWorkspaces()
    } catch (error) {
      console.error(error)
      message.error('移除失败')
    }
  }

  const vectorModelMissing = hasVectorModel === false
  const hasWorkspaceList = workspaces.length > 0
  const workspaceScanDisabled = !hasWorkspaceList
  const filePrepareRunning = runningFileJob?.action === 'prepare' || filePrepareHeld
  const workspacePrepareDisabled = filePrepareCancelling
    ? true
    : filePrepareRunning
      ? false
      : hasVectorModel !== true || actionableIndexCount === 0
  const workspacePrepareLabel = filePrepareCancelling
    ? '停止中'
    : filePrepareRunning
      ? '取消'
      : '更新索引'
  const workspacePrepareTooltip =
    hasVectorModel === null
      ? '正在检查向量模型状态'
      : vectorModelMissing
        ? ''
        : actionableIndexCount === 0
          ? '当前没有需要更新的索引'
          : filePrepareRunning
            ? '停止本次更新索引，已完成的会保留。'
            : '检查目录变化并更新可索引文件。'
  const vectorModelRequirementContent = (
    <div className="w-[220px]">
      <div className="text-[13px] font-medium text-[#37352F]">先安装向量模型</div>
      <div className="mt-1 text-[12px] leading-5 text-[#787774]">安装后才能更新索引。</div>
      <Button
        type="link"
        size="small"
        className="mt-2 !h-auto !p-0 !text-[#2F3437]"
        onClick={() => navigate('/settings/vector')}
      >
        去安装
      </Button>
    </div>
  )

  const webCount = webSourceCount

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden"
      data-testid={settingsSelectors.workspacePanel}
    >
      <div
        className="flex h-full min-h-0 flex-col overflow-hidden bg-white"
        data-testid={importSelectors.page}
      >
        <div className="min-h-0 flex flex-1 flex-col overflow-hidden px-5 py-5 pr-4">
          <Tabs
            className="flex h-full min-h-0 flex-col [&_.ant-tabs-content]:h-full [&_.ant-tabs-content-holder]:min-h-0 [&_.ant-tabs-content-holder]:flex-1 [&_.ant-tabs-nav]:mb-4 [&_.ant-tabs-tabpane]:h-full [&_.ant-tabs-tabpane]:overflow-hidden"
            activeKey={selectedTabKey}
            onChange={(key) => setSelectedTabKey(key as 'files' | 'web')}
            items={[
              {
                key: 'files',
                label: `文件 ${summedSummary.file_count}`,
                children: (
                  <div className="flex h-full min-h-0 flex-col gap-4">
                    <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[260px_minmax(0,1fr)]">
                      <div className="space-y-5">
                        <section className="nc-settings-side-section pb-4">
                          <div className="text-[14px] font-semibold text-[#37352F]">文件地址</div>
                          <div className="mt-2 text-[12px] leading-5 text-[#787774]">
                            添加你默认工作的目录。
                          </div>
                          <div className="mt-4">
                            <Button
                              type="primary"
                              className="w-full"
                              icon={<HiOutlineFolderPlus className="h-4 w-4" />}
                              onClick={() => void handleAddRoot()}
                              data-testid={importSelectors.createWorkspaceButton}
                            >
                              添加目录
                            </Button>
                          </div>
                        </section>

                        <section className="nc-settings-side-section pb-4">
                          <div className="flex items-center gap-1.5">
                            <div className="text-[14px] font-semibold text-[#37352F]">索引状态</div>
                            <Tooltip title="索引后的文件会加速搜索，并在一定程度降低 token 消耗。">
                              <HiOutlineQuestionMarkCircle className="h-4 w-4 cursor-help text-[#9B9A97] transition-colors hover:text-[#37352F]" />
                            </Tooltip>
                          </div>
                          <div className="mt-3 text-[12px] text-[#787774]">
                            <div className="ui-inset px-3 py-3">
                              <div className="inline-flex items-center gap-1.5">
                                <HiArrowPath className="h-4 w-4 text-[#787774]" />
                                <span>可索引</span>
                              </div>
                              <div
                                className="mt-1 text-[16px] font-semibold text-[#37352F]"
                                data-testid={importSelectors.workspaceActionableIndexCount}
                              >
                                {actionableIndexCount}
                              </div>
                              {summedSummary.failed_file_count > 0 ? (
                                <div
                                  className="mt-1 text-[11px] text-[#B3261E]"
                                  data-testid={importSelectors.workspaceActionableFailedHint}
                                >
                                  含失败 {summedSummary.failed_file_count} 个
                                </div>
                              ) : null}
                            </div>
                          </div>
                          <KnowledgeIndexSpeedControl prepareRunning={filePrepareRunning} />
                          <div className="mt-4 grid grid-cols-2 gap-2">
                            <Tooltip title="检查当前目录里有哪些新增、变更或删除。">
                              <Button
                                icon={<HiArrowPath className="h-4 w-4" />}
                                onClick={() => void handleWorkspaceScanAll()}
                                loading={runningFileJob?.action === 'scan'}
                                disabled={workspaceScanDisabled}
                                data-testid={importSelectors.workspaceQuickScanButton}
                              >
                                检查更新
                              </Button>
                            </Tooltip>
                            <div className="relative min-w-0">
                              <Tooltip title={workspacePrepareTooltip}>
                                <Button
                                  type="primary"
                                  icon={<HiCircleStack className="h-4 w-4" />}
                                  onClick={handleWorkspacePrepareButtonClick}
                                  disabled={workspacePrepareDisabled}
                                  className={`w-full min-w-0 ${vectorModelMissing ? '!pr-9' : ''}`}
                                  data-testid={importSelectors.workspaceQuickPrepareButton}
                                >
                                  {workspacePrepareLabel}
                                </Button>
                              </Tooltip>
                              {vectorModelMissing ? (
                                <Popover
                                  trigger={['hover', 'click']}
                                  placement="topRight"
                                  content={vectorModelRequirementContent}
                                >
                                  <button
                                    type="button"
                                    className="absolute right-1 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-[6px] border border-[#EEEEEC] bg-white text-[#9B9A97] transition hover:border-[#DAD8D2] hover:text-[#37352F]"
                                    aria-label="为什么不能更新索引"
                                  >
                                    <HiOutlineQuestionMarkCircle className="h-4 w-4" />
                                  </button>
                                </Popover>
                              ) : null}
                            </div>
                          </div>
                          <WorkspaceIndexJobProgress
                            job={displayFileIndexJob}
                            testId={importSelectors.workspaceIndexJobProgress}
                          />
                        </section>
                      </div>

                      <div className="flex min-h-0 min-w-0 flex-col">
                        <div className="mb-3 flex items-center justify-between">
                          <div className="text-[14px] font-semibold text-[#37352F]">目录树</div>
                          <Tooltip title="刷新">
                            <Button
                              size="small"
                              aria-label="刷新目录树"
                              icon={
                                <HiArrowPath
                                  className={
                                    workspaceLoading ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'
                                  }
                                />
                              }
                              onClick={() => void refreshVisibleWorkspaceTree()}
                              data-testid={importSelectors.workspaceTreeRefreshButton}
                            />
                          </Tooltip>
                        </div>
                        <div
                          className="nc-list-shell-borderless flex min-h-0 flex-1 overflow-auto px-1 py-3"
                          data-testid={importSelectors.workspaceTree}
                        >
                          {workspaces.length === 0 ? (
                            <div
                              className="flex min-h-0 flex-1 items-center justify-center"
                              data-testid={importSelectors.workspaceEmptyState}
                            >
                              <Empty
                                image={Empty.PRESENTED_IMAGE_SIMPLE}
                                description={<span className="text-[#787774]">还没有文件地址</span>}
                              />
                            </div>
                          ) : (
                            <div
                              className="workspace-file-tree w-full"
                              data-testid={importSelectors.workspaceList}
                            >
                              {workspaces.map((workspace) => {
                                const isRootCollapsed = collapsedRootIds.includes(workspace.id)
                                const isDirectoryRoot = workspace.root_kind !== 'file'
                                return (
                                  <div
                                    key={workspace.id}
                                    data-testid={`${importSelectors.workspaceCardPrefix}-${workspace.id}`}
                                  >
                                    <div className="group flex min-h-[30px] w-full items-center gap-1.5 rounded-[4px] px-2 text-[13px] text-[#37352F]">
                                      <button
                                        type="button"
                                        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                                        onClick={() =>
                                          isDirectoryRoot
                                            ? toggleRootCollapsed(workspace.id)
                                            : undefined
                                        }
                                      >
                                        <span className="flex h-4 w-4 shrink-0 items-center justify-center text-[#91918E]">
                                          {isDirectoryRoot ? (
                                            isRootCollapsed ? (
                                              <HiChevronRight />
                                            ) : (
                                              <HiChevronDown />
                                            )
                                          ) : null}
                                        </span>
                                        <FileIcon
                                          name={getRootDisplayName(workspace)}
                                          kind={isDirectoryRoot ? 'directory' : undefined}
                                          expanded={!isRootCollapsed}
                                        />
                                        <div className="min-w-0 flex-1">
                                          <div className="truncate font-medium">
                                            {getRootDisplayName(workspace)}
                                          </div>
                                          <div className="truncate text-[11px] text-[#91918E]">
                                            {workspace.root_path}
                                          </div>
                                        </div>
                                      </button>
                                      <Tooltip title="移除">
                                        <Button
                                          danger
                                          type="text"
                                          size="small"
                                          icon={<HiOutlineTrash className="h-4 w-4" />}
                                          className="!h-6 !w-6 !p-0 opacity-0 group-hover:opacity-100"
                                          aria-label={`移除 ${getRootDisplayName(workspace)}`}
                                          onClick={() => setDeleteWorkspaceId(workspace.id)}
                                          data-testid={importSelectors.workspaceRemoveButton}
                                        />
                                      </Tooltip>
                                    </div>
                                    {isDirectoryRoot && !isRootCollapsed
                                      ? renderWorkspaceEntries(workspace.id, '', 1)
                                      : null}
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              },
              {
                key: 'web',
                label: `网页 ${webCount}`,
                children: (
                  <WebSourcesSettingsPanel
                    embedded
                    hasVectorModel={hasVectorModel}
                    onVectorModelSettingsOpen={() => navigate('/settings/vector')}
                    onSummaryChange={(summary) => setWebSourceCount(summary.web_count)}
                  />
                )
              }
            ]}
          />
        </div>
      </div>

      <Modal
        title="移除文件地址"
        open={Boolean(deleteWorkspaceId)}
        maskClosable={false}
        onCancel={() => setDeleteWorkspaceId(null)}
        onOk={() => void handleDeleteWorkspace()}
        okText="移除"
        okButtonProps={{
          danger: true,
          'data-testid': importSelectors.workspaceDeleteConfirmButton
        }}
        cancelText="取消"
        cancelButtonProps={{ 'data-testid': importSelectors.workspaceDeleteCancelButton }}
        className="[&_.ant-modal-content]:!rounded-[8px]"
      >
        <p className="mb-0 text-[#787774]">
          移除后，该路径将不再作为资料根。若仍需使用，请重新添加并重新建立索引。
        </p>
      </Modal>
      <IndexPrepareCancelModal
        open={fileCancelModalOpen}
        confirmTestId={importSelectors.workspaceIndexCancelConfirmButton}
        continueTestId={importSelectors.workspaceIndexCancelContinueButton}
        onStop={() => void handleConfirmFilePrepareCancel()}
        onContinue={() => setFileCancelModalOpen(false)}
      />
    </div>
  )
}

export default WorkspaceSettingsPanel
