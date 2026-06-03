import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Empty, Input, Modal, Tabs, Tooltip, Tree, message } from 'antd'
import type {
  WorkspaceIndexJobRecord,
  LegacyLocalImportMigrationStatus,
  WorkspaceListItem,
  WorkspaceTreeListResponse
} from '../../../../shared/types'
import {
  HiArrowPath,
  HiDocumentText,
  HiGlobeAlt,
  HiOutlineArrowsPointingIn,
  HiOutlineArrowsPointingOut,
  HiOutlineFolderPlus,
  HiOutlineQuestionMarkCircle,
  HiOutlineTrash,
  HiSparkles
} from 'react-icons/hi2'
import { importSelectors, settingsSelectors } from '../../testing/selectors'
import WebSourcesSettingsPanel from './WebSourcesSettingsPanel'
import WorkspaceIndexJobProgress from './WorkspaceIndexJobProgress'
import {
  createWorkspaceTree,
  getDefaultExpandedKeys,
  getVisibleWorkspaceTreeEntries,
  getWorkspaceTreeDisplayStrategy
} from './utils/workspace'
import type { WorkspaceJobMap, WorkspaceTreeMap } from './types'

const WorkspaceSettingsPanel: React.FC = () => {
  const [workspaces, setWorkspaces] = useState<WorkspaceListItem[]>([])
  const [workspaceTrees, setWorkspaceTrees] = useState<WorkspaceTreeMap>({})
  const [workspaceTreeSummaries, setWorkspaceTreeSummaries] = useState<
    Record<string, WorkspaceTreeListResponse['summary']>
  >({})
  const [workspaceExpandedKeys, setWorkspaceExpandedKeys] = useState<Record<string, string[]>>({})
  const [workspaceIndexJobs, setWorkspaceIndexJobs] = useState<WorkspaceJobMap>({})
  const [workspaceLoading, setWorkspaceLoading] = useState(false)
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null)
  const [selectedTabKey, setSelectedTabKey] = useState<'files' | 'web'>('files')
  const [legacyMigrationStatus, setLegacyMigrationStatus] =
    useState<LegacyLocalImportMigrationStatus | null>(null)
  const [createModalVisible, setCreateModalVisible] = useState(false)
  const [createWorkspaceName, setCreateWorkspaceName] = useState('')
  const [createSubmitting, setCreateSubmitting] = useState(false)
  const [deleteWorkspaceId, setDeleteWorkspaceId] = useState<string | null>(null)

  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === selectedWorkspaceId) || null,
    [selectedWorkspaceId, workspaces]
  )

  const selectedWorkspaceIndexJob = useMemo(
    () => (selectedWorkspaceId ? workspaceIndexJobs[selectedWorkspaceId] : undefined),
    [selectedWorkspaceId, workspaceIndexJobs]
  )

  const selectedWorkspaceEntries = useMemo(
    () =>
      selectedWorkspaceId
        ? getVisibleWorkspaceTreeEntries(workspaceTrees[selectedWorkspaceId] || [])
        : [],
    [selectedWorkspaceId, workspaceTrees]
  )

  const selectedWorkspaceTreeStrategy = useMemo(
    () => getWorkspaceTreeDisplayStrategy(selectedWorkspaceEntries),
    [selectedWorkspaceEntries]
  )

  const selectedWorkspaceTree = useMemo(
    () => createWorkspaceTree(selectedWorkspaceEntries),
    [selectedWorkspaceEntries]
  )

  const loadWorkspaceTree = useCallback(
    async (workspaceId: string, includeUnsupported?: boolean): Promise<WorkspaceTreeListResponse> => {
      return await window.api.workspaceTree({
        workspaceId,
        includeUnsupported: Boolean(includeUnsupported)
      })
    },
    []
  )

  const loadWorkspaces = useCallback(async (): Promise<void> => {
    setWorkspaceLoading(true)
    try {
      const workspaceResponse = await window.api.workspaceList()
      setWorkspaces(workspaceResponse.items)

      const nextTrees: WorkspaceTreeMap = {}
      const nextSummaries: Record<string, WorkspaceTreeListResponse['summary']> = {}
      await Promise.all(
        workspaceResponse.items.map(async (workspace) => {
          const response = await loadWorkspaceTree(workspace.id, true)
          nextTrees[workspace.id] = response.items
          nextSummaries[workspace.id] = response.summary
        })
      )

      setWorkspaceTrees(nextTrees)
      setWorkspaceTreeSummaries(nextSummaries)
      setWorkspaceExpandedKeys((previous) => {
        const next = { ...previous }
        workspaceResponse.items.forEach((workspace) => {
          if (!next[workspace.id]) {
            const entries = getVisibleWorkspaceTreeEntries(nextTrees[workspace.id] || [])
            next[workspace.id] = getDefaultExpandedKeys(
              entries,
              getWorkspaceTreeDisplayStrategy(entries).defaultExpandDepth
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
  }, [loadWorkspaceTree])

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
    const unsubscribe = window.api.sourceListRefresh(() => {
      void loadWorkspaces()
    })
    return () => {
      unsubscribe()
    }
  }, [loadWorkspaces])

  useEffect(() => {
    const handleProgress = (job: WorkspaceIndexJobRecord): void => {
      if (job.source_kind !== 'file') return
      setWorkspaceIndexJobs((previous) => ({
        ...previous,
        [job.workspace_id]: job.status === 'running' ? job : undefined
      }))
      void loadWorkspaces()
    }
    return window.api.onWorkspaceIndexJobProgress(handleProgress)
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

  const reloadSelectedWorkspaceTree = useCallback(async (): Promise<void> => {
    if (!selectedWorkspaceId) return
    const response = await loadWorkspaceTree(selectedWorkspaceId, true)
    setWorkspaceTrees((previous) => ({
      ...previous,
      [selectedWorkspaceId]: response.items
    }))
    setWorkspaceTreeSummaries((previous) => ({
      ...previous,
      [selectedWorkspaceId]: response.summary
    }))
  }, [loadWorkspaceTree, selectedWorkspaceId])

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
        message.error(response.error || '创建工作空间失败')
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
      message.error(response.error || '设置工作文件地址失败')
      return
    }
    message.success('工作文件地址已设置')
    await loadWorkspaces()
    await reloadSelectedWorkspaceTree()
  }

  const handleWorkspaceScan = async (workspace: WorkspaceListItem): Promise<void> => {
    try {
      const response = await window.api.workspaceScan({ workspaceId: workspace.id })
      if (!response.success) {
        message.error(response.error || '检查更新失败')
        return
      }
      if (response.job) {
        setWorkspaceIndexJobs((previous) => ({ ...previous, [workspace.id]: response.job }))
      }
      await loadWorkspaces()
      await reloadSelectedWorkspaceTree()
    } catch (error) {
      console.error(error)
      message.error('检查更新失败')
    }
  }

  const handleWorkspacePrepare = async (workspace: WorkspaceListItem): Promise<void> => {
    try {
      const response = await window.api.workspacePrepare({
        workspaceId: workspace.id
      })
      if (!response.success) {
        message.error(response.error || '更新索引失败')
        return
      }
      if (response.job) {
        setWorkspaceIndexJobs((previous) => ({ ...previous, [workspace.id]: response.job }))
      }
      await loadWorkspaces()
      await reloadSelectedWorkspaceTree()
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
      <section className="ui-panel-ghost shrink-0 px-4 py-3">
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
              onClick={() => setCreateModalVisible(true)}
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
          className="rounded-[18px] border-[#FDECC8] bg-[#FFF9ED] text-[#666666]"
          message="检测到旧本地导入记录"
          description={`已清理 ${legacyMigrationStatus.removedDocumentCount} 条旧记录与 ${legacyMigrationStatus.removedChunkCount} 条 chunk。`}
        />
      ) : null}

      <div className="grid min-h-0 flex-1 gap-4 overflow-hidden pr-1 xl:grid-cols-[340px_minmax(0,1fr)]">
        <section className="ui-panel flex min-h-0 flex-col" data-testid={importSelectors.page}>
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
                const isSelected = workspace.id === selectedWorkspaceId

                return (
                  <button
                    key={workspace.id}
                    type="button"
                    onClick={() => setSelectedWorkspaceId(workspace.id)}
                    data-testid={`${importSelectors.workspaceCardPrefix}-${workspace.id}`}
                    className={`ui-hover-lift w-full rounded-[14px] border px-4 py-4 text-left ${
                      isSelected
                        ? 'border-[#D97757] bg-[#FCFBF8] shadow-[0_0_0_1px_rgba(244,229,223,0.9)]'
                        : 'border-[#E5E5E4] bg-white hover:border-[#D4D4D3] hover:bg-[#FCFBF8]'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-[14px] font-semibold text-[#1F1F1F]">
                        {workspace.name}
                      </div>
                      <div className="mt-1 break-all text-[12px] text-[#666666]">
                        {workspace.root_path || '未设置文件目录'}
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-[#666666]">
                      <span className="ui-status-pill border-transparent bg-[#F7F5F1] text-[#666666]">
                        <HiDocumentText className="h-3.5 w-3.5" />
                        {workspace.file_count}
                      </span>
                      <span className="ui-status-pill border-transparent bg-[#F4F6FB] text-[#5B6B8C]">
                        <HiGlobeAlt className="h-3.5 w-3.5" />
                        {workspace.web_count}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </section>

        <section
          className="ui-panel flex min-h-0 flex-col overflow-hidden"
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
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      danger
                      icon={<HiOutlineTrash className="h-4 w-4" />}
                      onClick={() => setDeleteWorkspaceId(selectedWorkspace.id)}
                      data-testid={importSelectors.workspaceRemoveButton}
                    >
                      移除
                    </Button>
                  </div>
                </div>
              </div>

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
                          <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
                            <div className="space-y-4">
                              <section className="ui-panel-soft p-4">
                                <div className="text-[14px] font-semibold text-[#1F1F1F]">文件目录</div>
                                <div className="mt-2 break-all text-[12px] leading-5 text-[#666666]">
                                  {selectedWorkspace.root_path || '未设置工作文件地址'}
                                </div>
                                <Button
                                  className="mt-4 w-full border-[#E5E5E4] bg-white text-[#1F1F1F]"
                                  onClick={() => void handleSetWorkspaceRootPath(selectedWorkspace)}
                                >
                                  设置工作文件地址
                                </Button>
                              </section>

                              <section className="ui-panel-soft p-4">
                                <div className="flex items-center gap-1.5">
                                  <div className="text-[14px] font-semibold text-[#1F1F1F]">索引状态</div>
                                  <Tooltip title="索引后的文件会加速搜索，并在一定程度降低 token 消耗，减少 AI 花费哦。">
                                    <HiOutlineQuestionMarkCircle className="h-4 w-4 cursor-help text-[#999999] transition-colors hover:text-[#D97757]" />
                                  </Tooltip>
                                </div>

                                <div className="mt-3 grid grid-cols-2 gap-2 text-[12px] text-[#666666]">
                                  <div className="ui-inset px-3 py-3">
                                    <div className="inline-flex items-center gap-1.5">
                                      <HiArrowPath className="h-4 w-4 text-[#AD7B18]" />
                                      <span>需索引</span>
                                    </div>
                                    <div className="mt-1 text-[16px] font-semibold text-[#1F1F1F]">
                                      {selectedWorkspaceSummary.needs_index_count}
                                    </div>
                                  </div>
                                  <div className="ui-inset px-3 py-3">
                                    <div className="inline-flex items-center gap-1.5">
                                      <HiOutlineTrash className="h-4 w-4 text-[#B5455D]" />
                                      <span>失败</span>
                                    </div>
                                    <div className="mt-1 text-[16px] font-semibold text-[#1F1F1F]">
                                      {selectedWorkspaceSummary.failed_file_count}
                                    </div>
                                  </div>
                                </div>

                                <div className="mt-4 grid grid-cols-2 gap-2">
                                  <Tooltip
                                    title="检查当前目录里有哪些新增、变更或删除。"
                                  >
                                    <Button
                                      icon={<HiArrowPath className="h-4 w-4" />}
                                      onClick={() => void handleWorkspaceScan(selectedWorkspace)}
                                      disabled={Boolean(selectedWorkspaceIndexJob)}
                                      loading={selectedWorkspaceIndexJob?.action === 'scan'}
                                      className="border-[#E5E5E4] bg-white text-[#1F1F1F]"
                                      data-testid={importSelectors.workspaceQuickScanButton}
                                    >
                                      检查更新
                                    </Button>
                                  </Tooltip>
                                  <Tooltip
                                    title="检查目录变化并更新可索引文件。"
                                  >
                                    <Button
                                      type="primary"
                                      icon={<HiSparkles className="h-4 w-4" />}
                                      onClick={() => void handleWorkspacePrepare(selectedWorkspace)}
                                      disabled={Boolean(selectedWorkspaceIndexJob)}
                                      loading={selectedWorkspaceIndexJob?.action === 'prepare'}
                                      data-testid={importSelectors.workspaceQuickPrepareButton}
                                    >
                                      更新索引
                                    </Button>
                                  </Tooltip>
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
                                  <div className="text-[14px] font-semibold text-[#1F1F1F]">目录树</div>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  <Tooltip
                                    title={
                                      (workspaceExpandedKeys[selectedWorkspace.id] || []).length > 0
                                        ? '全部折叠'
                                        : '恢复默认展开'
                                    }
                                  >
                                    <Button
                                      size="small"
                                      className="border-[#E5E5E4] bg-white text-[#1F1F1F]"
                                      icon={
                                        (workspaceExpandedKeys[selectedWorkspace.id] || []).length > 0 ? (
                                          <HiOutlineArrowsPointingIn className="h-4 w-4" />
                                        ) : (
                                          <HiOutlineArrowsPointingOut className="h-4 w-4" />
                                        )
                                      }
                                      onClick={() =>
                                        setWorkspaceExpandedKeys((previous) => ({
                                          ...previous,
                                          [selectedWorkspace.id]:
                                            (previous[selectedWorkspace.id] || []).length > 0
                                              ? []
                                              : getDefaultExpandedKeys(
                                                  selectedWorkspaceEntries,
                                                  selectedWorkspaceTreeStrategy.defaultExpandDepth
                                                )
                                        }))
                                      }
                                    />
                                  </Tooltip>
                                </div>
                              </div>

                              <div
                                className="ui-inset flex min-h-0 flex-1 overflow-auto p-3"
                                data-testid={importSelectors.workspaceTree}
                              >
                                {selectedWorkspaceEntries.length > 0 ? (
                                  <Tree
                                    blockNode
                                    className="w-full"
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
                                      description={<span className="text-[#666666]">当前目录没有可显示文件</span>}
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
        okButtonProps={{
          danger: true,
          'data-testid': importSelectors.workspaceDeleteConfirmButton
        }}
        cancelText="取消"
        cancelButtonProps={{ 'data-testid': importSelectors.workspaceDeleteCancelButton }}
        className="[&_.ant-modal-content]:!rounded-[24px]"
      >
        <p className="mb-0 text-[#666666]">
          移除后，该工作空间将不再出现在资料范围和聊天范围里。若仍需使用，请重新添加并重新建立索引。
        </p>
      </Modal>

      <Modal
        title="添加工作空间"
        open={createModalVisible}
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
        className="[&_.ant-modal-content]:!rounded-[24px]"
      >
        <div className="space-y-2 pt-2">
          <div className="text-sm font-medium text-[#1F1F1F]">工作空间名称</div>
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
