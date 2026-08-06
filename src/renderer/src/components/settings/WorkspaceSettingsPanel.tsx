import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Empty, Input, Modal, Popover, Tabs, Tooltip, message } from 'antd'
import { useNavigate } from 'react-router-dom'
import type {
  WorkspaceIndexJobRecord,
  LegacyLocalImportMigrationStatus,
  WorkspaceListItem,
  WorkspaceTreeEntry,
  WorkspaceDirectoryListResponse
} from '../../../../shared/types'
import {
  HiArrowPath,
  HiChevronDown,
  HiChevronRight,
  HiCircleStack,
  HiDocumentText,
  HiFolder,
  HiGlobeAlt,
  HiOutlineFolderPlus,
  HiOutlineQuestionMarkCircle,
  HiOutlineTrash
} from 'react-icons/hi2'
import { importSelectors, settingsSelectors } from '../../testing/selectors'
import { normalizeUserFacingError } from '../../utils/userFacingError'
import WebSourcesSettingsPanel from './WebSourcesSettingsPanel'
import WorkspaceIndexJobProgress from './WorkspaceIndexJobProgress'
import {
  getTreeEntryStatusMeta
} from './utils/workspace'
import type { WorkspaceJobMap } from './types'

type WorkspaceDirectoryMap = Record<string, Record<string, WorkspaceTreeEntry[]>>
type WorkspaceDirectoryLoadingMap = Record<string, Record<string, boolean>>
type WorkspaceDirectoryErrorMap = Record<string, Record<string, string | undefined>>

const WorkspaceSettingsPanel: React.FC = () => {
  const navigate = useNavigate()
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
  const [workspaceIndexJobs, setWorkspaceIndexJobs] = useState<WorkspaceJobMap>({})
  const [workspaceLoading, setWorkspaceLoading] = useState(false)
  const [workspaceDirectoryReloadVersion, setWorkspaceDirectoryReloadVersion] = useState(0)
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null)
  const [selectedTabKey, setSelectedTabKey] = useState<'files' | 'web'>('files')
  const [legacyMigrationStatus, setLegacyMigrationStatus] =
    useState<LegacyLocalImportMigrationStatus | null>(null)
  const [createModalVisible, setCreateModalVisible] = useState(false)
  const [createWorkspaceName, setCreateWorkspaceName] = useState('')
  const [createSubmitting, setCreateSubmitting] = useState(false)
  const [deleteWorkspaceId, setDeleteWorkspaceId] = useState<string | null>(null)
  const [hasVectorModel, setHasVectorModel] = useState<boolean | null>(null)
  const workspaceDirectoryRequestIds = useRef<Record<string, Record<string, number>>>({})

  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === selectedWorkspaceId) || null,
    [selectedWorkspaceId, workspaces]
  )

  const selectedWorkspaceIndexJob = useMemo(
    () => (selectedWorkspaceId ? workspaceIndexJobs[selectedWorkspaceId] : undefined),
    [selectedWorkspaceId, workspaceIndexJobs]
  )

  const selectedWorkspaceEntries = selectedWorkspaceId
    ? workspaceDirectories[selectedWorkspaceId]?.[''] || []
    : []

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
      setWorkspaceDirectoryLoading((previous) => ({
        ...previous,
        [workspaceId]: { ...previous[workspaceId], [relativePath]: true }
      }))
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
            [workspaceId]: response.summary as NonNullable<WorkspaceDirectoryListResponse['summary']>
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

  const loadWorkspaces = useCallback(async (): Promise<void> => {
    setWorkspaceLoading(true)
    try {
      const workspaceResponse = await window.api.workspaceList()
      setWorkspaces(workspaceResponse.items)
      setWorkspaceDirectories({})
      setWorkspaceDirectoryLoading({})
      setWorkspaceDirectoryErrors({})
      setWorkspaceTreeSummaries({})
      setWorkspaceExpandedKeys({})
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

  const loadVectorModelAvailability = useCallback(async (): Promise<void> => {
    try {
      const models = await window.api.getModels()
      setHasVectorModel(models.some((model) => model.isDownloaded))
    } catch (error) {
      console.error(error)
      setHasVectorModel(false)
    }
  }, [])

  useEffect(() => {
    void loadWorkspaces()
  }, [loadWorkspaces])

  useEffect(() => {
    void loadVectorModelAvailability()
  }, [loadVectorModelAvailability])

  useEffect(() => {
    void window.api
      .legacyLocalImportMigrationStatus()
      .then(setLegacyMigrationStatus)
      .catch(console.error)
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
        if (job.workspace_id === selectedWorkspaceId) {
          void loadWorkspaceDirectory(job.workspace_id, '')
        }
      }
    }
    return window.api.onWorkspaceIndexJobProgress(handleProgress)
  }, [loadWorkspaceDirectory, refreshWorkspaceList, selectedWorkspaceId])

  useEffect(() => {
    if (workspaces.length === 0) {
      setSelectedWorkspaceId(null)
      return
    }

    if (
      !selectedWorkspaceId ||
      !workspaces.some((workspace) => workspace.id === selectedWorkspaceId)
    ) {
      setSelectedWorkspaceId(workspaces[0].id)
    }
  }, [selectedWorkspaceId, workspaces])

  useEffect(() => {
    if (!selectedWorkspaceId) return
    void window.api
      .workspaceIndexJobGet({ workspaceId: selectedWorkspaceId, sourceKind: 'file' })
      .then((response) => {
        if (!response.success) return
        setWorkspaceIndexJobs((previous) => ({
          ...previous,
          [selectedWorkspaceId]: response.job?.status === 'running' ? response.job : undefined
        }))
      })
      .catch(console.error)
  }, [selectedWorkspaceId])

  useEffect(() => {
    if (!selectedWorkspace?.root_path || !selectedWorkspaceId) return
    void loadWorkspaceDirectory(selectedWorkspaceId, '')
  }, [loadWorkspaceDirectory, selectedWorkspace?.root_path, selectedWorkspaceId, workspaceDirectoryReloadVersion])

  const selectedWorkspaceSummary = useMemo(
    () =>
      (selectedWorkspaceId ? workspaceTreeSummaries[selectedWorkspaceId] : undefined) || {
        file_count: 0,
        indexed_file_count: 0,
        needs_index_count: 0,
        failed_file_count: 0
      },
    [selectedWorkspaceId, workspaceTreeSummaries]
  )

  const selectedWorkspaceActionableIndexCount =
    selectedWorkspaceSummary.needs_index_count + selectedWorkspaceSummary.failed_file_count

  const toggleWorkspaceDirectory = (entry: WorkspaceTreeEntry): void => {
    if (!selectedWorkspaceId || entry.kind !== 'directory') return
    const workspaceId = selectedWorkspaceId
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

  const renderWorkspaceEntries = (workspaceId: string, parentPath: string, depth: number): React.ReactNode => {
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
          const childLoading = workspaceDirectoryLoading[workspaceId]?.[entry.relative_path] === true
          return (
            <React.Fragment key={entry.id}>
              <button
                type="button"
                className="ant-tree-treenode flex min-h-8 w-full items-center gap-2 rounded-[4px] px-2 text-left text-[13px] text-[#37352F] hover:bg-[#F4F4F2]"
                style={{ paddingLeft: 8 + depth * 18 }}
                onClick={() => (isDirectory ? toggleWorkspaceDirectory(entry) : undefined)}
              >
                <span className="ant-tree-switcher flex h-4 w-4 shrink-0 items-center justify-center text-[#91918E]">
                  {isDirectory ? (isExpanded ? <HiChevronDown /> : <HiChevronRight />) : null}
                </span>
                {isDirectory ? (
                  <HiFolder className="h-4 w-4 shrink-0 text-[#787774]" />
                ) : (
                  <HiDocumentText className="h-4 w-4 shrink-0 text-[#91918E]" />
                )}
                <span className="min-w-0 flex-1 truncate" title={entry.relative_path}>
                  {entry.name}
                </span>
                {childLoading ? <HiArrowPath className="h-3.5 w-3.5 animate-spin text-[#91918E]" /> : null}
                {!isDirectory && entryStatus ? (
                  <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[11px] ${entryStatus.className}`}>
                    {entryStatus.label}
                  </span>
                ) : null}
              </button>
              {isDirectory && isExpanded
                ? renderWorkspaceEntries(workspaceId, entry.relative_path, depth + 1)
                : null}
            </React.Fragment>
          )
        })}
        {loading && entries.length === 0 ? (
          <div className="flex items-center gap-2 px-3 py-3 text-xs text-[#91918E]" style={{ paddingLeft: 8 + depth * 18 }}>
            <HiArrowPath className="h-3.5 w-3.5 animate-spin" />
            正在读取目录
          </div>
        ) : null}
        {error ? (
          <button
            type="button"
            className="px-3 py-2 text-xs text-[#B3261E] hover:underline"
            style={{ marginLeft: 8 + depth * 18 }}
            onClick={() => void loadWorkspaceDirectory(workspaceId, parentPath)}
          >
            读取失败，点击重试
          </button>
        ) : null}
      </div>
    )
  }

  const handleCreateWorkspace = async (): Promise<void> => {
    const name = createWorkspaceName.trim()
    if (!name) {
      message.warning('请输入工作空间名称')
      return
    }
    setCreateSubmitting(true)
    try {
      const response = await window.api.workspaceCreate({ name })
      if (!response.success || !response.workspace) {
        message.error(normalizeUserFacingError(response.error, '创建工作空间失败'))
        return
      }

      message.success('工作空间已加入 Workspace')
      setCreateModalVisible(false)
      setCreateWorkspaceName('')
      await loadWorkspaces()
      setSelectedWorkspaceId(response.workspace.id)
    } catch (error) {
      console.error(error)
      message.error('创建工作空间失败')
    } finally {
      setCreateSubmitting(false)
    }
  }

  const handleSetWorkspaceRootPath = async (workspace: WorkspaceListItem): Promise<void> => {
    const selection = await window.api.pickDirectory()
    if (selection.error) {
      message.error(selection.error)
      return
    }
    if (selection.canceled || !selection.path) {
      return
    }

    const response = await window.api.workspaceSetRootPath({
      workspaceId: workspace.id,
      rootPath: selection.path.trim()
    })
    if (!response.success) {
      message.error(normalizeUserFacingError(response.error, '设置工作目录失败'))
      return
    }
    message.success('工作目录已设置')
    await loadWorkspaces()
  }

  const handleWorkspaceScan = async (workspace: WorkspaceListItem): Promise<void> => {
    try {
      const response = await window.api.workspaceScan({ workspaceId: workspace.id })
      if (!response.success) {
        message.error(normalizeUserFacingError(response.error, '检查更新失败'))
        return
      }
    } catch (error) {
      console.error(error)
      message.error('检查更新失败')
    }
  }

  const handleWorkspacePrepare = async (workspace: WorkspaceListItem): Promise<void> => {
    if (hasVectorModel !== true) {
      message.warning('请先安装向量模型后再更新索引')
      return
    }

    try {
      const response = await window.api.workspacePrepare({
        workspaceId: workspace.id
      })
      if (!response.success) {
        message.error(normalizeUserFacingError(response.error, '更新索引失败'))
        return
      }
    } catch (error) {
      console.error(error)
      message.error('更新索引失败')
    }
  }

  const handleDeleteWorkspace = async (): Promise<void> => {
    if (!deleteWorkspaceId) return
    try {
      const response = await window.api.workspaceDelete(deleteWorkspaceId)
      if (!response.success) {
        message.error(normalizeUserFacingError(response.error, '移除工作空间失败'))
        return
      }
      message.success('工作空间已移除')
      setDeleteWorkspaceId(null)
      await loadWorkspaces()
    } catch (error) {
      console.error(error)
      message.error('移除工作空间失败')
    }
  }

  const vectorModelMissing = hasVectorModel === false
  const workspacePrepareDisabled = hasVectorModel !== true
  const workspacePrepareTooltip =
    hasVectorModel === null
      ? '正在检查向量模型状态'
      : vectorModelMissing
        ? ''
        : '检查目录变化并更新可索引文件。'
  const vectorModelRequirementContent = (
    <div className="w-[220px]">
      <div className="text-[13px] font-medium text-[#37352F]">先安装向量模型</div>
      <div className="mt-1 text-[12px] leading-5 text-[#787774]">
        安装后才能为工作空间更新索引。
      </div>
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

  return (
    <div
      className="flex h-full min-h-0 flex-col gap-4 overflow-hidden"
      data-testid={settingsSelectors.workspacePanel}
    >
      {legacyMigrationStatus?.hasLegacyLocalImports ? (
        <Alert
          showIcon
          className="rounded-[8px] border-[#EEEEEC] bg-[#F7F7F5] text-[#787774]"
          message="检测到旧本地导入记录"
          description={`已清理 ${legacyMigrationStatus.removedDocumentCount} 条旧记录与 ${legacyMigrationStatus.removedChunkCount} 条 chunk。`}
        />
      ) : null}

      <div className="nc-page-split">
        <section
          className="flex min-h-0 flex-col overflow-hidden border-r border-[#EEEEEC] bg-white"
          data-testid={importSelectors.page}
        >
          <div className="px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <div className="text-[15px] font-semibold text-[#37352F]">工作空间</div>
                <div className="text-[12px] text-[#787774]">共 {workspaces.length} 个</div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Tooltip title="刷新">
                  <Button
                    size="small"
                    icon={<HiArrowPath className="h-4 w-4" />}
                    className="border-[#EEEEEC] bg-white text-[#37352F]"
                    onClick={() => void loadWorkspaces()}
                    loading={workspaceLoading}
                    aria-label="刷新"
                  />
                </Tooltip>
                <Tooltip title="添加工作空间">
                  <Button
                    type="primary"
                    size="small"
                    icon={<HiOutlineFolderPlus className="h-4 w-4" />}
                    onClick={() => setCreateModalVisible(true)}
                    loading={createSubmitting}
                    aria-label="添加工作空间"
                    data-testid={importSelectors.createWorkspaceButton}
                  />
                </Tooltip>
              </div>
            </div>
          </div>

          {workspaces.length === 0 ? (
            <div
              className="flex min-h-0 flex-1 items-center justify-center px-6"
              data-testid={importSelectors.workspaceEmptyState}
            >
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={<span className="text-[#787774]">暂无工作空间</span>}
              />
            </div>
          ) : (
            <div
              className="flex-1 space-y-1 overflow-y-auto px-2 py-3 pr-2"
              data-testid={importSelectors.workspaceList}
            >
              {workspaces.map((workspace) => {
                const isSelected = workspace.id === selectedWorkspaceId

                return (
                  <div
                    key={workspace.id}
                    data-testid={`${importSelectors.workspaceCardPrefix}-${workspace.id}`}
                    className={`nc-sidebar-item px-3 py-3 ${
                      isSelected ? 'nc-sidebar-item-active' : 'bg-transparent'
                    }`}
                  >
                    <button
                      type="button"
                      className="block w-full cursor-pointer border-0 bg-transparent p-0 text-left"
                      onClick={() => setSelectedWorkspaceId(workspace.id)}
                    >
                      <div className="min-w-0">
                        <div className="text-[14px] font-semibold text-[#37352F]">
                          {workspace.name}
                        </div>
                        <div className="mt-1 break-all text-[12px] text-[#787774]">
                          {workspace.root_path || '未设置文件目录'}
                        </div>
                      </div>
                    </button>

                    <div className="mt-3 flex items-end justify-between gap-2">
                      <div className="flex flex-wrap gap-2 text-[11px] text-[#787774]">
                        <span className="nc-tag">
                          <HiDocumentText className="h-3.5 w-3.5" />
                          {workspace.file_count}
                        </span>
                        <span className="nc-tag">
                          <HiGlobeAlt className="h-3.5 w-3.5" />
                          {workspace.web_count}
                        </span>
                      </div>
                      <Tooltip title="移除工作空间">
                        <Button
                          danger
                          type="text"
                          size="small"
                          icon={<HiOutlineTrash className="h-4 w-4" />}
                          aria-label="移除工作空间"
                          onClick={(event) => {
                            event.stopPropagation()
                            setDeleteWorkspaceId(workspace.id)
                          }}
                          data-testid={importSelectors.workspaceRemoveButton}
                        />
                      </Tooltip>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        <section
          className="flex min-h-0 flex-col overflow-hidden bg-white"
          data-testid={importSelectors.workspaceDetail}
        >
          {selectedWorkspace ? (
            <>
              <div className="min-h-0 flex flex-1 flex-col overflow-hidden px-5 py-5 pr-4">
                <Tabs
                  className="flex h-full min-h-0 flex-col [&_.ant-tabs-content]:h-full [&_.ant-tabs-content-holder]:min-h-0 [&_.ant-tabs-content-holder]:flex-1 [&_.ant-tabs-nav]:mb-4 [&_.ant-tabs-tabpane]:h-full [&_.ant-tabs-tabpane]:overflow-hidden"
                  activeKey={selectedTabKey}
                  onChange={(key) => setSelectedTabKey(key as 'files' | 'web')}
                  items={[
                    {
                      key: 'files',
                      label: `文件 ${selectedWorkspace.file_count}`,
                      children: (
                        <div className="flex h-full min-h-0 flex-col gap-4">
                          <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[260px_minmax(0,1fr)]">
                            <div className="space-y-5">
                              <section className="nc-settings-side-section pb-4">
                                <div className="text-[14px] font-semibold text-[#37352F]">
                                  文件目录
                                </div>
                                {!selectedWorkspace.root_path ? (
                                  <div className="mt-2 text-[12px] leading-5 text-[#787774]">
                                    设置后才能在 Workbench 中发送任务。
                                  </div>
                                ) : null}
                                <Button
                                  type="primary"
                                  className="mt-4 w-full"
                                  onClick={() => void handleSetWorkspaceRootPath(selectedWorkspace)}
                                >
                                  {selectedWorkspace.root_path ? '更换工作目录' : '设置工作目录'}
                                </Button>
                              </section>

                              <section className="nc-settings-side-section pb-4">
                                <div className="flex items-center gap-1.5">
                                  <div className="text-[14px] font-semibold text-[#37352F]">
                                    索引状态
                                  </div>
                                  <Tooltip title="索引后的文件会加速搜索，并在一定程度降低 token 消耗，减少 AI 花费哦。">
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
                                      {selectedWorkspaceActionableIndexCount}
                                    </div>
                                    {selectedWorkspaceSummary.failed_file_count > 0 ? (
                                      <div
                                        className="mt-1 text-[11px] text-[#B3261E]"
                                        data-testid={importSelectors.workspaceActionableFailedHint}
                                      >
                                        含失败 {selectedWorkspaceSummary.failed_file_count} 个
                                      </div>
                                    ) : null}
                                  </div>
                                </div>

                                <div className="mt-4 grid grid-cols-2 gap-2">
                                  <Tooltip title="检查当前目录里有哪些新增、变更或删除。">
                                    <Button
                                      icon={<HiArrowPath className="h-4 w-4" />}
                                      onClick={() => void handleWorkspaceScan(selectedWorkspace)}
                                      loading={selectedWorkspaceIndexJob?.action === 'scan'}
                                      className="border-[#EEEEEC] bg-white text-[#37352F]"
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
                                        onClick={() =>
                                          void handleWorkspacePrepare(selectedWorkspace)
                                        }
                                        disabled={workspacePrepareDisabled}
                                        loading={selectedWorkspaceIndexJob?.action === 'prepare'}
                                        className={`w-full min-w-0 ${vectorModelMissing ? '!pr-9' : ''}`}
                                        data-testid={importSelectors.workspaceQuickPrepareButton}
                                      >
                                        更新索引
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
                                  job={selectedWorkspaceIndexJob}
                                  testId={importSelectors.workspaceIndexJobProgress}
                                />
                              </section>
                            </div>

                            <div className="flex min-h-0 min-w-0 flex-col">
                              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                                <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                                  <div className="text-[14px] font-semibold text-[#37352F]">
                                    目录树
                                  </div>
                                </div>
                              </div>

                              <div
                                className="nc-list-shell-borderless flex min-h-0 flex-1 overflow-auto px-1 py-3"
                                data-testid={importSelectors.workspaceTree}
                              >
                                {selectedWorkspaceEntries.length > 0 ? (
                                  <div className="workspace-file-tree w-full">
                                    {renderWorkspaceEntries(selectedWorkspace.id, '', 0)}
                                  </div>
                                ) : workspaceDirectoryLoading[selectedWorkspace.id]?.[''] ? (
                                  <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-sm text-[#91918E]">
                                    <HiArrowPath className="h-4 w-4 animate-spin" />
                                    正在读取根目录
                                  </div>
                                ) : workspaceDirectoryErrors[selectedWorkspace.id]?.[''] ? (
                                  <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-sm text-[#B3261E]">
                                    <span>根目录读取失败</span>
                                    <Button size="small" onClick={() => void loadWorkspaceDirectory(selectedWorkspace.id, '')}>
                                      重试
                                    </Button>
                                  </div>
                                ) : (
                                  <div className="flex min-h-0 flex-1 items-center justify-center">
                                    <Empty
                                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                                      description={
                                        <span className="text-[#787774]">
                                          当前目录没有可显示文件
                                        </span>
                                      }
                                    />
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
                      label: `网页 ${selectedWorkspace.web_count}`,
                      children: (
                        <WebSourcesSettingsPanel
                          workspaceId={selectedWorkspace.id}
                          workspaceName={selectedWorkspace.name}
                          embedded
                          hasVectorModel={hasVectorModel}
                          onVectorModelSettingsOpen={() => navigate('/settings/vector')}
                        />
                      )
                    }
                  ]}
                />
              </div>
            </>
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center px-6">
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={<span className="text-[#787774]">选择一个工作空间</span>}
              />
            </div>
          )}
        </section>
      </div>

      <Modal
        title="移除工作空间"
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
          移除后，该工作空间将不再出现在资料范围和聊天范围里。若仍需使用，请重新添加并重新建立索引。
        </p>
      </Modal>

      <Modal
        title="添加工作空间"
        open={createModalVisible}
        maskClosable={false}
        confirmLoading={createSubmitting}
        onCancel={() => {
          setCreateModalVisible(false)
          setCreateWorkspaceName('')
        }}
        onOk={() => void handleCreateWorkspace()}
        okText="添加"
        cancelText="取消"
        okButtonProps={{ 'data-testid': importSelectors.createWorkspaceConfirmButton }}
        cancelButtonProps={{ 'data-testid': importSelectors.createWorkspaceCancelButton }}
        data-testid={importSelectors.createWorkspaceModal}
        className="[&_.ant-modal-content]:!rounded-[8px]"
      >
        <div className="space-y-2 pt-2">
          <div className="text-sm font-medium text-[#37352F]">工作空间名称</div>
          <Input
            value={createWorkspaceName}
            onChange={(event) => setCreateWorkspaceName(event.target.value)}
            onPressEnter={() => void handleCreateWorkspace()}
            placeholder="输入工作空间名称"
            data-testid={importSelectors.createWorkspaceNameInput}
          />
        </div>
      </Modal>
    </div>
  )
}

export default WorkspaceSettingsPanel
