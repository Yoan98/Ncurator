import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Empty, Modal, Progress, Segmented, Tag, Tooltip, Tree, message } from 'antd'
import type {
  LegacyLocalImportMigrationStatus,
  WorkspacePrepareMode,
  WorkspaceSource
} from '../../../../shared/types'
import {
  HiArrowPath,
  HiCheckCircle,
  HiOutlineExclamationCircle,
  HiOutlineFolderPlus,
  HiOutlineQuestionMarkCircle,
  HiOutlineTrash,
  HiOutlineWindow,
  HiSparkles
} from 'react-icons/hi2'
import { importSelectors, settingsSelectors } from '../../testing/selectors'
import StatusTag from './StatusTag'
import {
  createWorkspaceTree,
  formatDateTime,
  getDefaultExpandedKeys,
  getWorkspaceActionTooltip,
  getVisibleWorkspaceNodes,
  getWorkspaceStatusBadge,
  getWorkspaceStats,
  getWorkspaceTreeDisplayStrategy
} from './utils/workspace'
import type {
  WorkspaceActionMap,
  WorkspaceModeMap,
  WorkspaceNodeMap,
  WorkspaceProgressMap
} from './types'

const getWorkspaceNameFromPath = (rootPath: string): string => {
  const normalizedPath = rootPath.replace(/[\\/]+$/, '')
  const segments = normalizedPath.split(/[\\/]/).filter(Boolean)
  return segments[segments.length - 1] || normalizedPath
}

const WORKSPACE_LOAD_MODE_OPTIONS: Array<{
  label: string
  value: WorkspacePrepareMode
  description: string
}> = [
  {
    label: '全部',
    value: 'full',
    description: '当前目录下所有支持加载的文件都会重新加载，并覆盖旧缓存。'
  },
  {
    label: '新变更',
    value: 'presence_only',
    description: '只同步新增和删除的文件；已有文件内容不会重新加载。'
  },
  {
    label: '旧文件',
    value: 'changes_only',
    description: '只检查并重新加载之前已加载过且内容有变更的旧文件，不处理新增和删除。'
  }
]

const SUPPORTED_WORKSPACE_FILE_TYPES = ['docx', 'pdf'] as const

const WorkspaceSettingsPanel: React.FC = () => {
  const [workspaces, setWorkspaces] = useState<WorkspaceSource[]>([])
  const [workspaceNodes, setWorkspaceNodes] = useState<WorkspaceNodeMap>({})
  const [workspaceExpandedKeys, setWorkspaceExpandedKeys] = useState<Record<string, string[]>>({})
  const [workspaceActions, setWorkspaceActions] = useState<WorkspaceActionMap>({})
  const [workspaceProgress, setWorkspaceProgress] = useState<WorkspaceProgressMap>({})
  const [workspaceModes, setWorkspaceModes] = useState<WorkspaceModeMap>({})
  const [workspaceLoading, setWorkspaceLoading] = useState(false)
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null)
  const [legacyMigrationStatus, setLegacyMigrationStatus] =
    useState<LegacyLocalImportMigrationStatus | null>(null)
  const [createSubmitting, setCreateSubmitting] = useState(false)
  const [deleteWorkspaceId, setDeleteWorkspaceId] = useState<string | null>(null)

  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === selectedWorkspaceId) || null,
    [selectedWorkspaceId, workspaces]
  )

  const selectedWorkspaceNodes = useMemo(
    () =>
      selectedWorkspaceId ? getVisibleWorkspaceNodes(workspaceNodes[selectedWorkspaceId] || []) : [],
    [selectedWorkspaceId, workspaceNodes]
  )

  const selectedWorkspaceTreeStrategy = useMemo(
    () => getWorkspaceTreeDisplayStrategy(selectedWorkspaceNodes),
    [selectedWorkspaceNodes]
  )

  const selectedWorkspaceTree = useMemo(
    () => createWorkspaceTree(selectedWorkspaceNodes),
    [selectedWorkspaceNodes]
  )

  const selectedWorkspaceStatusBadge = useMemo(() => {
    if (!selectedWorkspace) return null
    return getWorkspaceStatusBadge({
      status: selectedWorkspace.status,
      lastError: selectedWorkspace.last_error,
      lastPrepareAt: selectedWorkspace.last_prepare_at,
      lastScanAt: selectedWorkspace.last_scan_at,
      action: workspaceActions[selectedWorkspace.id],
      progress: workspaceProgress[selectedWorkspace.id]
    })
  }, [selectedWorkspace, workspaceActions, workspaceProgress])

  const loadWorkspaces = useCallback(async (): Promise<void> => {
    setWorkspaceLoading(true)
    try {
      const workspaceResponse = await window.api.workspaceList()
      setWorkspaces(workspaceResponse.items)

      const nextNodes: WorkspaceNodeMap = {}
      await Promise.all(
        workspaceResponse.items.map(async (workspace) => {
          const response = await window.api.workspaceNodes({ workspaceId: workspace.id })
          nextNodes[workspace.id] = response.items
        })
      )

      setWorkspaceNodes(nextNodes)
      setWorkspaceExpandedKeys((previous) => {
        const next = { ...previous }
        workspaceResponse.items.forEach((workspace) => {
          if (!next[workspace.id]) {
            const nodes = getVisibleWorkspaceNodes(nextNodes[workspace.id] || [])
            next[workspace.id] = getDefaultExpandedKeys(
              nodes,
              getWorkspaceTreeDisplayStrategy(nodes).defaultExpandDepth
            )
          }
        })
        return next
      })
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
      .legacyLocalImportMigrationStatus()
      .then(setLegacyMigrationStatus)
      .catch(console.error)
  }, [])

  useEffect(() => {
    window.api.sourceListRefresh(() => {
      void loadWorkspaces()
    })
    return () => {
      window.api.removeSourceListRefreshListeners()
    }
  }, [loadWorkspaces])

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

  const handleCreateWorkspace = async (): Promise<void> => {
    setCreateSubmitting(true)
    try {
      const selection = await window.api.pickDirectory()
      if (selection.error) {
        message.error(selection.error)
        return
      }
      if (selection.canceled || !selection.path) {
        return
      }

      const rootPath = selection.path.trim()
      const response = await window.api.workspaceCreate({
        rootPath,
        name: getWorkspaceNameFromPath(rootPath)
      })
      if (!response.success || !response.workspace) {
        message.error(response.error || '创建工作空间失败')
        return
      }

      message.success('工作空间已加入 Workspace')
      await loadWorkspaces()
      setSelectedWorkspaceId(response.workspace.id)
    } catch (error) {
      console.error(error)
      message.error('创建工作空间失败')
    } finally {
      setCreateSubmitting(false)
    }
  }

  const handleWorkspaceScan = async (workspace: WorkspaceSource): Promise<void> => {
    setWorkspaceActions((previous) => ({ ...previous, [workspace.id]: 'scan' }))
    setWorkspaceProgress((previous) => ({
      ...previous,
      [workspace.id]: {
        workspace_id: workspace.id,
        phase: 'scan',
        total: 0,
        completed: 0,
        message: '正在刷新目录快照'
      }
    }))

    try {
      const response = await window.api.workspaceScan({ workspaceId: workspace.id })
      if (!response.success) {
        message.error(response.error || '扫描失败')
        return
      }
      if (response.progress) {
        setWorkspaceProgress((previous) => ({ ...previous, [workspace.id]: response.progress }))
      }
      await loadWorkspaces()
      message.success('扫描完成')
    } catch (error) {
      console.error(error)
      message.error('扫描失败')
    } finally {
      setWorkspaceActions((previous) => ({ ...previous, [workspace.id]: undefined }))
      setWorkspaceProgress((previous) => ({ ...previous, [workspace.id]: undefined }))
    }
  }

  const handleWorkspacePrepare = async (workspace: WorkspaceSource): Promise<void> => {
    const mode = workspaceModes[workspace.id] || 'changes_only'
    setWorkspaceActions((previous) => ({ ...previous, [workspace.id]: 'prepare' }))
    setWorkspaceProgress((previous) => ({
      ...previous,
      [workspace.id]: {
        workspace_id: workspace.id,
        mode,
        phase: 'prepare',
        total: 0,
        completed: 0,
        message: '正在加载资料'
      }
    }))

    try {
      const response = await window.api.workspacePrepare({
        workspaceId: workspace.id,
        mode
      })
      if (!response.success) {
        message.error(response.error || '加载失败')
        return
      }
      if (response.progress) {
        setWorkspaceProgress((previous) => ({ ...previous, [workspace.id]: response.progress }))
      }
      await loadWorkspaces()
      message.success('加载完成')
    } catch (error) {
      console.error(error)
      message.error('加载失败')
    } finally {
      setWorkspaceActions((previous) => ({ ...previous, [workspace.id]: undefined }))
      setWorkspaceProgress((previous) => ({ ...previous, [workspace.id]: undefined }))
    }
  }

  const handleDeleteWorkspace = async (): Promise<void> => {
    if (!deleteWorkspaceId) return
    try {
      const response = await window.api.workspaceDelete(deleteWorkspaceId)
      if (!response.success) {
        message.error(response.error || '移除工作空间失败')
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

  return (
    <div
      className="flex h-full min-h-0 flex-col gap-4 overflow-hidden"
      data-testid={settingsSelectors.workspacePanel}
    >
      <section className="shrink-0 rounded-[18px] border border-[#E5E5E4] bg-white/88 px-4 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)] backdrop-blur-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold tracking-tight text-[#1F1F1F]">工作空间</h2>
            <div className="text-[12px] text-[#666666]">共 {workspaces.length} 个</div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              icon={<HiArrowPath className="h-4 w-4" />}
              className="border-[#E5E5E4] bg-white text-[#1F1F1F]"
              onClick={() => void loadWorkspaces()}
              loading={workspaceLoading}
            >
              刷新
            </Button>
            <Button
              type="primary"
              icon={<HiOutlineFolderPlus className="h-4 w-4" />}
              onClick={() => void handleCreateWorkspace()}
              loading={createSubmitting}
              data-testid={importSelectors.createWorkspaceButton}
            >
              添加工作空间
            </Button>
          </div>
        </div>
      </section>

      {legacyMigrationStatus?.hasLegacyLocalImports ? (
        <Alert
          showIcon
          icon={<HiOutlineExclamationCircle className="h-4 w-4" />}
          className="rounded-[18px] border-[#FDECC8] bg-[#FFF9ED] text-[#666666]"
          message="检测到旧本地导入记录"
          description={`已清理 ${legacyMigrationStatus.removedDocumentCount} 条旧记录与 ${legacyMigrationStatus.removedChunkCount} 条 chunk。`}
        />
      ) : null}

      <div className="grid min-h-0 flex-1 gap-4 overflow-hidden pr-1 xl:grid-cols-[340px_minmax(0,1fr)]">
        <section
          className="flex min-h-0 flex-col rounded-[20px] border border-[#E5E5E4] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
          data-testid={importSelectors.page}
        >
          <div className="border-b border-[#E5E5E4] px-4 py-4">
            <div className="text-[15px] font-semibold text-[#1F1F1F]">工作空间</div>
          </div>

          {workspaces.length === 0 ? (
            <div
              className="flex min-h-0 flex-1 items-center justify-center px-6"
              data-testid={importSelectors.workspaceEmptyState}
            >
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={<span className="text-[#666666]">暂无工作空间</span>}
              />
            </div>
          ) : (
            <div
              className="flex-1 space-y-2 overflow-y-auto px-3 py-3 pr-2"
              data-testid={importSelectors.workspaceList}
            >
              {workspaces.map((workspace) => {
                const visibleNodes = getVisibleWorkspaceNodes(workspaceNodes[workspace.id] || [])
                const stats = getWorkspaceStats(visibleNodes)
                const progress = workspaceProgress[workspace.id]
                const isSelected = workspace.id === selectedWorkspaceId
                const statusBadge = getWorkspaceStatusBadge({
                  status: workspace.status,
                  lastError: workspace.last_error,
                  lastPrepareAt: workspace.last_prepare_at,
                  lastScanAt: workspace.last_scan_at,
                  action: workspaceActions[workspace.id],
                  progress
                })

                return (
                  <button
                    key={workspace.id}
                    type="button"
                    onClick={() => setSelectedWorkspaceId(workspace.id)}
                    data-testid={`${importSelectors.workspaceCardPrefix}-${workspace.id}`}
                    className={`w-full rounded-[16px] border px-4 py-4 text-left transition-all duration-200 ${
                      isSelected
                        ? 'border-[#D97757] bg-[#FCFBF8] shadow-[0_4px_16px_rgba(217,119,87,0.10)]'
                        : 'border-[#E5E5E4] bg-white hover:border-[#D4D4D3] hover:bg-[#FCFBF8]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-[14px] font-semibold text-[#1F1F1F]">
                          {workspace.name}
                        </div>
                        <div className="mt-1 truncate text-[12px] text-[#666666]">
                          {workspace.root_path}
                        </div>
                      </div>
                      <StatusTag
                        label={statusBadge.label}
                        className={statusBadge.className}
                        tooltip={statusBadge.tooltip}
                        icon={statusBadge.icon}
                      />
                    </div>

                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[#666666]">
                      <span>目录 {stats.directoryCount}</span>
                      <span>文件 {stats.fileCount}</span>
                      <span>已加载 {stats.preparedCount}</span>
                      <span>
                        待处理 {stats.unpreparedCount + stats.staleCount + stats.failedCount}
                      </span>
                    </div>

                    {progress ? (
                      <div className="mt-3 rounded-[14px] border border-[#E5E5E4] bg-white px-3 py-3">
                        <div className="mb-2 flex items-center justify-between text-[12px] text-[#666666]">
                          <Tooltip title={progress.message || '最近任务'}>
                            <span className="inline-flex items-center gap-1.5">
                              {progress.phase === 'complete' ? (
                                <HiCheckCircle className="h-3.5 w-3.5 text-[#4F7A46]" />
                              ) : (
                                <HiArrowPath className="h-3.5 w-3.5 animate-spin text-[#D97757]" />
                              )}
                              <span>{progress.message || '最近任务'}</span>
                            </span>
                          </Tooltip>
                          <span>
                            {progress.total > 0
                              ? `${progress.completed}/${progress.total}`
                              : progress.phase === 'complete'
                                ? '完成'
                                : '进行中'}
                          </span>
                        </div>
                        <Progress
                          percent={
                            progress.total > 0
                              ? Math.round((progress.completed / progress.total) * 100)
                              : progress.phase === 'complete'
                                ? 100
                                : 0
                          }
                          size="small"
                          showInfo={false}
                          strokeColor="#D97757"
                          trailColor="#F4E5DF"
                        />
                      </div>
                    ) : null}
                  </button>
                )
              })}
            </div>
          )}
        </section>

        <section
          className="flex min-h-0 flex-col overflow-hidden rounded-[20px] border border-[#E5E5E4] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
          data-testid={importSelectors.workspaceDetail}
        >
          {selectedWorkspace ? (
            <>
              <div className="border-b border-[#E5E5E4] px-5 py-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-[16px] font-semibold text-[#1F1F1F]">
                        {selectedWorkspace.name}
                      </h3>
                      {selectedWorkspaceStatusBadge ? (
                        <StatusTag
                          label={selectedWorkspaceStatusBadge.label}
                          className={selectedWorkspaceStatusBadge.className}
                          tooltip={selectedWorkspaceStatusBadge.tooltip}
                          icon={selectedWorkspaceStatusBadge.icon}
                          dataTestId={importSelectors.workspaceStatus}
                        />
                      ) : null}
                    </div>
                    <div className="mt-2 break-all text-[12px] text-[#666666]">
                      {selectedWorkspace.root_path}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-3 text-[12px] text-[#999999]">
                      <span>最近扫描：{formatDateTime(selectedWorkspace.last_scan_at)}</span>
                      <span>最近加载：{formatDateTime(selectedWorkspace.last_prepare_at)}</span>
                    </div>
                    {selectedWorkspace.last_error ? (
                      <div
                        className="mt-3 rounded-[14px] border border-[#F7D5D9] bg-[#FFF2F4] px-3 py-2 text-[12px] text-[#B5455D]"
                        data-testid={importSelectors.workspaceLastError}
                      >
                        {selectedWorkspace.last_error}
                      </div>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      className="border-[#E5E5E4] bg-white text-[#1F1F1F]"
                      icon={<HiOutlineWindow className="h-4 w-4" />}
                      onClick={async () => {
                        const response = await window.api.revealPath(selectedWorkspace.root_path)
                        if (!response.success) {
                          message.error(response.error || '打开路径失败')
                        }
                      }}
                    >
                      打开路径
                    </Button>
                    <Button
                      danger
                      icon={<HiOutlineTrash className="h-4 w-4" />}
                      onClick={() => setDeleteWorkspaceId(selectedWorkspace.id)}
                    >
                      移除
                    </Button>
                  </div>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-hidden px-5 py-5 pr-4">
                <div className="grid h-full min-h-0 gap-4 xl:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
                  <div className="space-y-4 overflow-y-auto pr-1">
                    <section className="rounded-[18px] border border-[#E5E5E4] bg-[#FCFBF8] p-4">
                      <div className="flex items-center gap-1.5">
                        <div className="text-[14px] font-semibold text-[#1F1F1F]">加载范围</div>
                        <Tooltip title="加载会把文件文本切块并缓存，后续搜索更快，也能减少 AI 直接读取原文时的 token 消耗。">
                          <HiOutlineQuestionMarkCircle className="h-4 w-4 cursor-help text-[#999999] transition-colors hover:text-[#D97757]" />
                        </Tooltip>
                      </div>

                      <div className="mt-3 flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <Segmented
                            value={workspaceModes[selectedWorkspace.id] || 'changes_only'}
                            onChange={(value) =>
                              setWorkspaceModes((previous) => ({
                                ...previous,
                                [selectedWorkspace.id]: value as WorkspacePrepareMode
                              }))
                            }
                            options={WORKSPACE_LOAD_MODE_OPTIONS.map((option) => ({
                              label: option.label,
                              value: option.value
                            }))}
                            className="bg-[#F5F5F4]"
                            size="middle"
                          />
                        </div>
                        <Tooltip
                          title={
                            <div className="max-w-[280px] space-y-1.5 text-[12px] leading-5">
                              {WORKSPACE_LOAD_MODE_OPTIONS.map((option) => (
                                <div key={option.value}>
                                  <span className="font-medium">{option.label}</span>
                                  <span>：{option.description}</span>
                                </div>
                              ))}
                            </div>
                          }
                        >
                          <HiOutlineQuestionMarkCircle className="h-4 w-4 shrink-0 cursor-help text-[#999999] transition-colors hover:text-[#D97757]" />
                        </Tooltip>
                      </div>

                      <div className="mt-4 grid grid-cols-2 gap-2">
                        <Tooltip
                          title={getWorkspaceActionTooltip(
                            'scan',
                            workspaceProgress[selectedWorkspace.id]
                          )}
                        >
                          <Button
                            icon={<HiArrowPath className="h-4 w-4" />}
                            onClick={() => void handleWorkspaceScan(selectedWorkspace)}
                            loading={workspaceActions[selectedWorkspace.id] === 'scan'}
                            className="border-[#E5E5E4] bg-white text-[#1F1F1F]"
                            data-testid={importSelectors.workspaceQuickScanButton}
                          >
                            先扫描
                          </Button>
                        </Tooltip>
                        <Tooltip
                          title={getWorkspaceActionTooltip(
                            'prepare',
                            workspaceProgress[selectedWorkspace.id]
                          )}
                        >
                          <Button
                            type="primary"
                            icon={<HiSparkles className="h-4 w-4" />}
                            onClick={() => void handleWorkspacePrepare(selectedWorkspace)}
                            loading={workspaceActions[selectedWorkspace.id] === 'prepare'}
                            data-testid={importSelectors.workspaceQuickPrepareButton}
                          >
                            开始加载
                          </Button>
                        </Tooltip>
                      </div>
                    </section>

                    <section className="rounded-[18px] border border-[#E5E5E4] bg-white p-4">
                      <div className="text-[14px] font-semibold text-[#1F1F1F]">摘要</div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-[12px] text-[#666666]">
                        <div className="rounded-[14px] bg-[#FAFAF9] px-3 py-3">
                          目录 / 文件
                          <div className="mt-1 text-[13px] font-semibold text-[#1F1F1F]">
                            {getWorkspaceStats(selectedWorkspaceNodes).directoryCount} /{' '}
                            {getWorkspaceStats(selectedWorkspaceNodes).fileCount}
                          </div>
                        </div>
                        <div className="rounded-[14px] bg-[#FAFAF9] px-3 py-3">
                          已加载
                          <div className="mt-1 text-[13px] font-semibold text-[#1F1F1F]">
                            {getWorkspaceStats(selectedWorkspaceNodes).preparedCount}
                          </div>
                        </div>
                      </div>
                    </section>
                  </div>

                  <div className="flex min-h-0 min-w-0 flex-col">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                        <div className="text-[14px] font-semibold text-[#1F1F1F]">目录树</div>
                        {SUPPORTED_WORKSPACE_FILE_TYPES.map((fileType) => (
                          <Tag
                            key={fileType}
                            className="!mr-0 !inline-flex !items-center gap-1.5 !rounded-full !border !px-2.5 !py-1"
                            style={{
                              borderColor: '#D8EECF',
                              backgroundColor: '#EEF8E9',
                              color: '#4C7D37'
                            }}
                          >
                            <HiCheckCircle className="h-3.5 w-3.5" />
                            <span>{fileType}</span>
                          </Tag>
                        ))}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {selectedWorkspaceTreeStrategy.isLargeTree ? (
                          <Tag className="!mr-0 rounded-full border-[#FDECC8] bg-[#FFF9ED] text-[#AD7B18]">
                            大目录策略
                          </Tag>
                        ) : null}
                        <Button
                          size="small"
                          className="border-[#E5E5E4] bg-white text-[#1F1F1F]"
                          onClick={() =>
                            setWorkspaceExpandedKeys((previous) => ({
                              ...previous,
                              [selectedWorkspace.id]: getDefaultExpandedKeys(
                                selectedWorkspaceNodes,
                                selectedWorkspaceTreeStrategy.defaultExpandDepth
                              )
                            }))
                          }
                        >
                          恢复默认展开
                        </Button>
                        <Button
                          size="small"
                          className="border-[#E5E5E4] bg-white text-[#1F1F1F]"
                          onClick={() =>
                            setWorkspaceExpandedKeys((previous) => ({
                              ...previous,
                              [selectedWorkspace.id]: []
                            }))
                          }
                        >
                          全部折叠
                        </Button>
                      </div>
                    </div>

                    {workspaceActions[selectedWorkspace.id] ? (
                      <Alert
                        showIcon
                        icon={<HiOutlineExclamationCircle className="h-4 w-4" />}
                        className="!mb-3 rounded-[16px] border-[#F4E5DF] bg-[#FBF5F2] text-[#666666]"
                        message="扫描或加载进行中"
                      />
                    ) : null}

                    <div
                      className="flex min-h-0 flex-1 overflow-hidden rounded-[18px] border border-[#E5E5E4] bg-[#FAFAF9] p-3"
                      data-testid={importSelectors.workspaceTree}
                    >
                      {selectedWorkspaceNodes.length > 0 ? (
                        <Tree
                          blockNode
                          height={Math.max(selectedWorkspaceTreeStrategy.isLargeTree ? 520 : 460, 360)}
                          virtual
                          treeData={selectedWorkspaceTree}
                          expandedKeys={workspaceExpandedKeys[selectedWorkspace.id] || []}
                          onExpand={(expandedKeys) =>
                            setWorkspaceExpandedKeys((previous) => ({
                              ...previous,
                              [selectedWorkspace.id]: expandedKeys.map((item) => String(item))
                            }))
                          }
                        />
                      ) : (
                        <div className="flex min-h-0 flex-1 items-center justify-center">
                          <Empty
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                            description={<span className="text-[#666666]">没有可追踪文件</span>}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center px-6">
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={<span className="text-[#666666]">选择一个工作空间</span>}
              />
            </div>
          )}
        </section>
      </div>

      <Modal
        title="移除工作空间"
        open={Boolean(deleteWorkspaceId)}
        onCancel={() => setDeleteWorkspaceId(null)}
        onOk={() => void handleDeleteWorkspace()}
        okText="移除"
        okButtonProps={{ danger: true }}
        cancelText="取消"
        className="[&_.ant-modal-content]:!rounded-[24px]"
      >
        <p className="mb-0 text-[#666666]">
          移除后，该工作空间将不再出现在资料范围和聊天范围里。若仍需使用，请重新添加并重新加载。
        </p>
      </Modal>
    </div>
  )
}

export default WorkspaceSettingsPanel
