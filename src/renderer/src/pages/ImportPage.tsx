import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Empty,
  Input,
  List,
  message,
  Modal,
  Progress,
  Segmented,
  Tag,
  Tooltip,
  Tree,
  Typography
} from 'antd'
import type {
  LegacyLocalImportMigrationStatus,
  WebSourceRecord,
  WorkspaceNode,
  WorkspacePrepareMode,
  WorkspaceSource,
  WorkspaceSyncProgress
} from '../../../shared/types'
import {
  HiArrowPath,
  HiDocumentText,
  HiFolder,
  HiGlobeAlt,
  HiOutlineExclamationCircle,
  HiOutlineFolderPlus,
  HiOutlineQuestionMarkCircle,
  HiOutlineRectangleStack,
  HiOutlineTrash,
  HiOutlineWindow,
  HiSparkles
} from 'react-icons/hi2'

const { Title, Text, Paragraph, Link } = Typography

type WorkspaceTreeNode = {
  key: string
  title: React.ReactNode
  children?: WorkspaceTreeNode[]
}

type WorkspaceNodeMap = Record<string, WorkspaceNode[]>
type WorkspaceActionMap = Record<string, 'scan' | 'prepare' | undefined>
type WorkspaceProgressMap = Record<string, WorkspaceSyncProgress | undefined>
type WorkspaceModeMap = Record<string, WorkspacePrepareMode>
type WorkspaceTreeDisplayStrategy = {
  defaultExpandDepth: number
  isLargeTree: boolean
  helperText: string
}

const formatDateTime = (value?: number): string => {
  if (!value) return '未执行'
  return new Date(value).toLocaleString('zh-CN', {
    hour12: false
  })
}

const getWorkspaceStatusMeta = (
  status: WorkspaceSource['status']
): { label: string; className: string } => {
  if (status === 'prepared') {
    return { label: '已准备', className: 'border-[#DCEBD7] bg-[#F3FAF0] text-[#4F7A46]' }
  }
  if (status === 'preparing') {
    return { label: '准备中', className: 'border-[#FDE2D8] bg-[#FFF3EE] text-[#C66A4A]' }
  }
  if (status === 'scanning') {
    return { label: '扫描中', className: 'border-[#FDE2D8] bg-[#FFF3EE] text-[#C66A4A]' }
  }
  if (status === 'stale') {
    return { label: '待更新', className: 'border-[#FDECC8] bg-[#FFF9ED] text-[#AD7B18]' }
  }
  if (status === 'failed') {
    return { label: '失败', className: 'border-[#F7D5D9] bg-[#FFF2F4] text-[#B5455D]' }
  }
  if (status === 'unavailable') {
    return { label: '不可用', className: 'border-[#F7D5D9] bg-[#FFF2F4] text-[#B5455D]' }
  }
  return { label: '未准备', className: 'border-[#E5E5E4] bg-[#F8F8F7] text-[#666666]' }
}

const getNodeStatusMeta = (
  status: WorkspaceNode['prepare_status']
): { label: string; className: string } => {
  if (status === 'prepared') {
    return { label: '已准备', className: 'border-[#DCEBD7] bg-[#F3FAF0] text-[#4F7A46]' }
  }
  if (status === 'preparing') {
    return { label: '准备中', className: 'border-[#FDE2D8] bg-[#FFF3EE] text-[#C66A4A]' }
  }
  if (status === 'stale') {
    return { label: '待更新', className: 'border-[#FDECC8] bg-[#FFF9ED] text-[#AD7B18]' }
  }
  if (status === 'failed') {
    return { label: '失败', className: 'border-[#F7D5D9] bg-[#FFF2F4] text-[#B5455D]' }
  }
  if (status === 'missing') {
    return { label: '缺失', className: 'border-[#F7D5D9] bg-[#FFF2F4] text-[#B5455D]' }
  }
  return { label: '未准备', className: 'border-[#E5E5E4] bg-[#F8F8F7] text-[#666666]' }
}

const getWebStatusMeta = (
  status: WebSourceRecord['import_status']
): { label: string; className: string } => {
  if (status === 2) {
    return { label: '已抓取', className: 'border-[#DCEBD7] bg-[#F3FAF0] text-[#4F7A46]' }
  }
  if (status === 3) {
    return { label: '失败', className: 'border-[#F7D5D9] bg-[#FFF2F4] text-[#B5455D]' }
  }
  return { label: '处理中', className: 'border-[#FDE2D8] bg-[#FFF3EE] text-[#C66A4A]' }
}

const getWorkspaceStats = (nodes: WorkspaceNode[]) => {
  const fileNodes = nodes.filter((node) => node.kind === 'file')
  const directoryCount = nodes.filter((node) => node.kind === 'directory').length
  return {
    directoryCount,
    fileCount: fileNodes.length,
    preparedCount: fileNodes.filter((node) => node.prepare_status === 'prepared').length,
    staleCount: fileNodes.filter((node) => node.prepare_status === 'stale').length,
    failedCount: fileNodes.filter((node) => node.prepare_status === 'failed').length,
    unpreparedCount: fileNodes.filter((node) => node.prepare_status === 'not_prepared').length
  }
}

const createWorkspaceTree = (nodes: WorkspaceNode[]): WorkspaceTreeNode[] => {
  const sortedNodes = [...nodes].sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === 'directory' ? -1 : 1
    }
    return left.relative_path.localeCompare(right.relative_path)
  })

  const nodeMap = new Map<string, WorkspaceTreeNode>()
  const roots: WorkspaceTreeNode[] = []

  sortedNodes.forEach((node) => {
    const statusMeta = getNodeStatusMeta(node.prepare_status)
    const treeNode: WorkspaceTreeNode = {
      key: node.id,
      title: (
        <div className="flex min-w-0 items-center gap-2 py-1">
          {node.kind === 'directory' ? (
            <HiFolder className="w-4 h-4 text-[#D97757]" />
          ) : (
            <HiDocumentText className="w-4 h-4 text-[#666666]" />
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] text-[#1F1F1F]">{node.name}</div>
            <div className="truncate text-[12px] text-[#999999]">
              {node.relative_path || node.absolute_path}
            </div>
          </div>
          {node.kind === 'file' && (
            <Tag className={`!mr-0 rounded-full ${statusMeta.className}`}>{statusMeta.label}</Tag>
          )}
        </div>
      ),
      children: []
    }
    nodeMap.set(node.id, treeNode)
  })

  sortedNodes.forEach((node) => {
    const treeNode = nodeMap.get(node.id)
    if (!treeNode) return
    if (node.parent_id && nodeMap.has(node.parent_id)) {
      const parentNode = nodeMap.get(node.parent_id)
      parentNode?.children?.push(treeNode)
      return
    }
    roots.push(treeNode)
  })

  return roots
}

const getWorkspaceTreeDisplayStrategy = (nodes: WorkspaceNode[]): WorkspaceTreeDisplayStrategy => {
  const directoryCount = nodes.filter((node) => node.kind === 'directory').length
  const totalNodes = nodes.length
  if (totalNodes >= 800 || directoryCount >= 220) {
    return {
      defaultExpandDepth: 1,
      isLargeTree: true,
      helperText: '大型目录已切到保守展开策略：默认仅展开首层目录，深层目录按需手动展开。'
    }
  }
  return {
    defaultExpandDepth: 2,
    isLargeTree: totalNodes >= 260 || directoryCount >= 80,
    helperText: '默认展开到前两层目录，后续按需手动展开。'
  }
}

const getDefaultExpandedKeys = (nodes: WorkspaceNode[], depth: number): string[] =>
  nodes
    .filter((node) => node.kind === 'directory' && node.relative_path.split('/').length <= depth)
    .map((node) => node.id)

const ImportPage: React.FC = () => {
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
  const [createVisible, setCreateVisible] = useState(false)
  const [createRootPath, setCreateRootPath] = useState('')
  const [createName, setCreateName] = useState('')
  const [createSubmitting, setCreateSubmitting] = useState(false)
  const [deleteWorkspaceId, setDeleteWorkspaceId] = useState<string | null>(null)

  const [webSources, setWebSources] = useState<WebSourceRecord[]>([])
  const [webLoading, setWebLoading] = useState(false)
  const [webKeyword, setWebKeyword] = useState('')
  const [webModalVisible, setWebModalVisible] = useState(false)
  const [webUrlsText, setWebUrlsText] = useState('')
  const [webIncludeSelectorsText, setWebIncludeSelectorsText] = useState('')
  const [webExcludeSelectorsText, setWebExcludeSelectorsText] = useState('')
  const [webSubmitting, setWebSubmitting] = useState(false)
  const [deleteWebSource, setDeleteWebSource] = useState<WebSourceRecord | null>(null)

  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === selectedWorkspaceId) || null,
    [selectedWorkspaceId, workspaces]
  )
  const selectedWorkspaceNodes = selectedWorkspaceId ? workspaceNodes[selectedWorkspaceId] || [] : []
  const selectedWorkspaceTreeStrategy = useMemo(
    () => getWorkspaceTreeDisplayStrategy(selectedWorkspaceNodes),
    [selectedWorkspaceNodes]
  )
  const selectedWorkspaceTree = useMemo(
    () => createWorkspaceTree(selectedWorkspaceNodes),
    [selectedWorkspaceNodes]
  )

  const loadWorkspaces = useCallback(async () => {
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
      setWorkspaceExpandedKeys((prev) => {
        const next = { ...prev }
        workspaceResponse.items.forEach((workspace) => {
          if (!next[workspace.id]) {
            const nodes = nextNodes[workspace.id] || []
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

  const loadWebSources = useCallback(async () => {
    setWebLoading(true)
    try {
      const response = await window.api.webSourceList()
      const keyword = webKeyword.trim().toLowerCase()
      const items = keyword
        ? response.items.filter((item) =>
            [item.title, item.url, item.normalized_url]
              .map((value) => String(value || '').toLowerCase())
              .some((value) => value.includes(keyword))
          )
        : response.items
      setWebSources(items)
    } catch (error) {
      console.error(error)
      message.error('加载网页资料失败')
    } finally {
      setWebLoading(false)
    }
  }, [webKeyword])

  useEffect(() => {
    void loadWorkspaces()
  }, [loadWorkspaces])

  useEffect(() => {
    void loadWebSources()
  }, [loadWebSources])

  useEffect(() => {
    void window.api.legacyLocalImportMigrationStatus().then(setLegacyMigrationStatus).catch(console.error)
  }, [])

  useEffect(() => {
    const handler = () => {
      void loadWorkspaces()
      void loadWebSources()
    }
    window.api.sourceListRefresh(handler)
    return () => {
      window.api.removeSourceListRefreshListeners()
    }
  }, [loadWebSources, loadWorkspaces])

  useEffect(() => {
    if (workspaces.length === 0) {
      setSelectedWorkspaceId(null)
      return
    }
    if (!selectedWorkspaceId || !workspaces.some((workspace) => workspace.id === selectedWorkspaceId)) {
      setSelectedWorkspaceId(workspaces[0].id)
    }
  }, [selectedWorkspaceId, workspaces])

  const parseSelectors = (input: string): string[] | undefined => {
    const values = input
      .split(/[\n,]/g)
      .map((item) => item.trim())
      .filter(Boolean)
    return values.length > 0 ? values : undefined
  }

  const handleCreateWorkspace = async () => {
    if (!createRootPath.trim()) {
      message.warning('请输入工作空间根路径')
      return
    }
    setCreateSubmitting(true)
    try {
      const response = await window.api.workspaceCreate({
        rootPath: createRootPath.trim(),
        name: createName.trim() || undefined
      })
      if (!response.success || !response.workspace) {
        message.error(response.error || '创建工作空间失败')
        return
      }
      message.success('工作空间已加入资料来源')
      setCreateVisible(false)
      setCreateRootPath('')
      setCreateName('')
      await loadWorkspaces()
      setSelectedWorkspaceId(response.workspace.id)
    } catch (error) {
      console.error(error)
      message.error('创建工作空间失败')
    } finally {
      setCreateSubmitting(false)
    }
  }

  const handleWorkspaceScan = async (workspace: WorkspaceSource) => {
    setWorkspaceActions((prev) => ({ ...prev, [workspace.id]: 'scan' }))
    setWorkspaceProgress((prev) => ({
      ...prev,
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
        setWorkspaceProgress((prev) => ({ ...prev, [workspace.id]: response.progress }))
      }
      await loadWorkspaces()
      message.success('扫描完成')
    } catch (error) {
      console.error(error)
      message.error('扫描失败')
    } finally {
      setWorkspaceActions((prev) => ({ ...prev, [workspace.id]: undefined }))
    }
  }

  const handleWorkspacePrepare = async (workspace: WorkspaceSource) => {
    const mode = workspaceModes[workspace.id] || 'changes_only'
    setWorkspaceActions((prev) => ({ ...prev, [workspace.id]: 'prepare' }))
    setWorkspaceProgress((prev) => ({
      ...prev,
      [workspace.id]: {
        workspace_id: workspace.id,
        mode,
        phase: 'prepare',
        total: 0,
        completed: 0,
        message: '正在按所选模式准备本地资料'
      }
    }))
    try {
      const response = await window.api.workspacePrepare({
        workspaceId: workspace.id,
        mode
      })
      if (!response.success) {
        message.error(response.error || '准备失败')
        return
      }
      if (response.progress) {
        setWorkspaceProgress((prev) => ({ ...prev, [workspace.id]: response.progress }))
      }
      await loadWorkspaces()
      message.success('准备完成')
    } catch (error) {
      console.error(error)
      message.error('准备失败')
    } finally {
      setWorkspaceActions((prev) => ({ ...prev, [workspace.id]: undefined }))
    }
  }

  const handleDeleteWorkspace = async () => {
    if (!deleteWorkspaceId) return
    try {
      const response = await window.api.workspaceDelete(deleteWorkspaceId)
      if (!response.success) {
        message.error(response.error || '删除工作空间失败')
        return
      }
      message.success('工作空间已移除')
      setDeleteWorkspaceId(null)
      await loadWorkspaces()
    } catch (error) {
      console.error(error)
      message.error('删除工作空间失败')
    }
  }

  const handleWebImport = async () => {
    if (webSubmitting) return
    const urls = Array.from(
      new Set(
        webUrlsText
          .split(/\r?\n/g)
          .map((item) => item.trim())
          .filter(Boolean)
      )
    )

    if (urls.length === 0) {
      message.warning('请输入至少一个 URL（每行一个）')
      return
    }

    const invalidUrls = urls.filter((url) => {
      try {
        const parsed = new URL(url)
        return !['http:', 'https:'].includes(parsed.protocol)
      } catch {
        return true
      }
    })
    if (invalidUrls.length > 0) {
      message.error(`URL 不合法：${invalidUrls.slice(0, 3).join('，')}${invalidUrls.length > 3 ? '…' : ''}`)
      return
    }

    setWebSubmitting(true)
    try {
      const includeSelectors = parseSelectors(webIncludeSelectorsText)
      const excludeSelectors = parseSelectors(webExcludeSelectorsText)
      if (urls.length === 1) {
        const response = await window.api.ingestWeb({
          url: urls[0],
          includeSelectors,
          excludeSelectors
        })
        if (!response.success) {
          message.error(response.error || '提交网页资料失败')
          return
        }
      } else {
        const response = await window.api.ingestWebs(
          urls.map((url) => ({
            url,
            includeSelectors,
            excludeSelectors
          }))
        )
        if (!response.success) {
          message.error(response.error || '提交网页资料失败')
          return
        }
      }
      message.success('网页资料已加入队列')
      setWebUrlsText('')
      setWebIncludeSelectorsText('')
      setWebExcludeSelectorsText('')
      setWebModalVisible(false)
      await loadWebSources()
    } catch (error) {
      console.error(error)
      message.error('提交网页资料失败')
    } finally {
      setWebSubmitting(false)
    }
  }

  const handleRefreshWebSource = async (source: WebSourceRecord) => {
    try {
      const response = await window.api.webSourceRefresh({ webSourceId: source.id })
      if (!response.success) {
        message.error(response.error || '刷新网页资料失败')
        return
      }
      message.success('网页资料已刷新')
      await loadWebSources()
    } catch (error) {
      console.error(error)
      message.error('刷新网页资料失败')
    }
  }

  const handleDeleteWebSource = async () => {
    if (!deleteWebSource) return
    try {
      const response = await window.api.webSourceDelete(deleteWebSource.id)
      if (!response.success) {
        message.error(response.error || '删除网页资料失败')
        return
      }
      message.success('网页资料已删除')
      setDeleteWebSource(null)
      await loadWebSources()
    } catch (error) {
      console.error(error)
      message.error('删除网页资料失败')
    }
  }

  return (
    <div className="min-h-full bg-[#F5F5F4] px-6 py-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-8">
        <div className="rounded-[28px] border border-[#E5E5E4] bg-[radial-gradient(circle_at_top_left,_#FBF5F2,_#F5F5F4_58%)] px-8 py-8 shadow-[0_4px_16px_rgba(0,0,0,0.06)]">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#F4E5DF] bg-white px-3 py-1 text-[12px] font-medium text-[#D97757]">
                <HiSparkles className="w-4 h-4" />
                资料来源
              </div>
              <Title level={2} className="!mb-3 !text-[#1F1F1F]">
                用工作空间和网页资料组织本地优先上下文
              </Title>
              <Paragraph className="!mb-0 !text-base !leading-relaxed !text-[#666666]">
                本地文件不再复制进知识库目录。请先配置工作空间，再按需扫描和准备范围；聊天里的
                <Text className="!text-[#D97757]"> @ </Text>
                会优先参考这些资料。
              </Paragraph>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button
                type="primary"
                size="large"
                icon={<HiOutlineFolderPlus className="w-4 h-4" />}
                onClick={() => setCreateVisible(true)}
              >
                添加工作空间
              </Button>
              <Button
                size="large"
                className="border-[#E5E5E4] bg-white text-[#1F1F1F]"
                icon={<HiGlobeAlt className="w-4 h-4" />}
                onClick={() => setWebModalVisible(true)}
              >
                导入网页资料
              </Button>
            </div>
          </div>
        </div>

        <Alert
          showIcon
          icon={<HiOutlineExclamationCircle className="w-4 h-4" />}
          className="rounded-3xl border-[#FDECC8] bg-[#FFF9ED] text-[#666666]"
          message="旧本地导入已下线"
          description={
            legacyMigrationStatus?.hasLegacyLocalImports
              ? `本次升级已清理 ${legacyMigrationStatus.removedDocumentCount} 条旧本地导入记录和 ${legacyMigrationStatus.removedChunkCount} 条 chunk。若历史聊天引用了这些资料，请重新添加对应工作空间。`
              : '旧版本通过复制文件导入的本地资料不再继续兼容。若你之前导入过本地文件，需要改为在这里重新添加工作空间。'
          }
        />

        <div className="grid gap-8 xl:grid-cols-[1.15fr_0.85fr]">
          <section className="rounded-3xl border border-[#E5E5E4] bg-white p-6 shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
            <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <HiOutlineRectangleStack className="w-5 h-5 text-[#D97757]" />
                  <Title level={4} className="!mb-0 !text-[#1F1F1F]">
                    工作空间
                  </Title>
                  <Tooltip title="工作空间会生成目录快照，AI 在聊天时可优先参考其中已准备或可直接读取的本地文件。">
                    <span className="inline-flex cursor-help items-center text-[#999999]">
                      <HiOutlineQuestionMarkCircle className="w-4 h-4" />
                    </span>
                  </Tooltip>
                </div>
                <Text className="text-[#666666]">
                  扫描用于建立目录树快照，准备用于将可检索内容写入本地知识库。
                </Text>
              </div>
              <Button
                size="large"
                icon={<HiArrowPath className="w-4 h-4" />}
                className="border-[#E5E5E4] bg-white text-[#1F1F1F]"
                onClick={() => void loadWorkspaces()}
                loading={workspaceLoading}
              >
                刷新列表
              </Button>
            </div>

            <Alert
              showIcon
              icon={<HiOutlineExclamationCircle className="w-4 h-4" />}
              className="!mb-5 rounded-2xl border-[#F4E5DF] bg-[#FBF5F2] text-[#666666]"
              message="本地优先"
              description="聊天和后续执行会优先使用工作空间里的本地信息；如果本地不足，系统会先提示用户是否允许使用非本地信息。"
            />

            {workspaces.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[#D4D4D3] bg-[#FAFAF9] px-6 py-14 text-center">
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={
                    <span className="text-[#666666]">
                      还没有工作空间。添加一个绝对路径后，资料来源页会维护目录快照和准备状态。
                    </span>
                  }
                />
              </div>
            ) : (
              <div className="grid gap-4 lg:grid-cols-[0.92fr_1.08fr]">
                <div className="space-y-4">
                  {workspaces.map((workspace) => {
                    const stats = getWorkspaceStats(workspaceNodes[workspace.id] || [])
                    const statusMeta = getWorkspaceStatusMeta(workspace.status)
                    const progress = workspaceProgress[workspace.id]
                    const action = workspaceActions[workspace.id]
                    const isSelected = workspace.id === selectedWorkspaceId
                    return (
                      <button
                        key={workspace.id}
                        type="button"
                        onClick={() => setSelectedWorkspaceId(workspace.id)}
                        className={`w-full rounded-2xl border p-5 text-left transition-all duration-200 ${
                          isSelected
                            ? 'border-[#D97757] bg-[#FBF5F2] shadow-[0_4px_16px_rgba(217,119,87,0.12)]'
                            : 'border-[#E5E5E4] bg-white hover:-translate-y-[1px] hover:shadow-[0_4px_16px_rgba(0,0,0,0.08)]'
                        }`}
                      >
                        <div className="mb-3 flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-base font-semibold text-[#1F1F1F]">
                              {workspace.name}
                            </div>
                            <div className="truncate text-sm text-[#666666]">{workspace.root_path}</div>
                          </div>
                          <Tag className={`!mr-0 rounded-full ${statusMeta.className}`}>
                            {statusMeta.label}
                          </Tag>
                        </div>

                        <div className="mb-4 grid grid-cols-2 gap-3 text-sm text-[#666666]">
                          <div className="rounded-xl border border-[#E5E5E4] bg-white px-3 py-2">
                            <div className="text-[12px] text-[#999999]">目录 / 文件</div>
                            <div className="text-[#1F1F1F]">
                              {stats.directoryCount} / {stats.fileCount}
                            </div>
                          </div>
                          <div className="rounded-xl border border-[#E5E5E4] bg-white px-3 py-2">
                            <div className="text-[12px] text-[#999999]">已准备 / 待处理</div>
                            <div className="text-[#1F1F1F]">
                              {stats.preparedCount} /{' '}
                              {stats.unpreparedCount + stats.staleCount + stats.failedCount}
                            </div>
                          </div>
                        </div>

                        {progress && (
                          <div className="mb-4 rounded-xl border border-[#E5E5E4] bg-white px-3 py-3">
                            <div className="mb-2 flex items-center justify-between text-[12px] text-[#666666]">
                              <span>
                                {progress.phase === 'scan'
                                  ? '最近扫描'
                                  : progress.phase === 'prepare'
                                    ? '最近准备'
                                    : '最近结果'}
                              </span>
                              <span>{progress.message || '已记录'}</span>
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
                              status={action ? 'active' : 'normal'}
                            />
                            <div className="mt-2 text-[12px] text-[#999999]">
                              新增 {progress.added || 0} · 更新 {progress.updated || 0} · 移除{' '}
                              {progress.removed || 0} · 失败 {progress.failed || 0}
                            </div>
                          </div>
                        )}

                        <div className="grid grid-cols-2 gap-2">
                          <Button
                            size="large"
                            icon={<HiArrowPath className="w-4 h-4" />}
                            onClick={(event) => {
                              event.stopPropagation()
                              void handleWorkspaceScan(workspace)
                            }}
                            loading={action === 'scan'}
                            className="border-[#E5E5E4] bg-white text-[#1F1F1F]"
                          >
                            扫描
                          </Button>
                          <Button
                            type="primary"
                            size="large"
                            icon={<HiSparkles className="w-4 h-4" />}
                            onClick={(event) => {
                              event.stopPropagation()
                              void handleWorkspacePrepare(workspace)
                            }}
                            loading={action === 'prepare'}
                          >
                            准备
                          </Button>
                        </div>
                      </button>
                    )
                  })}
                </div>

                <div className="rounded-2xl border border-[#E5E5E4] bg-[#FAFAF9] p-5">
                  {selectedWorkspace ? (
                    <div className="flex h-full flex-col">
                      <div className="mb-5 flex flex-col gap-4 border-b border-[#E5E5E4] pb-5">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <Text strong className="!text-[#1F1F1F]">
                                {selectedWorkspace.name}
                              </Text>
                              <Tag className={`!mr-0 rounded-full ${getWorkspaceStatusMeta(selectedWorkspace.status).className}`}>
                                {getWorkspaceStatusMeta(selectedWorkspace.status).label}
                              </Tag>
                            </div>
                            <Paragraph
                              ellipsis={{ rows: 2, expandable: true, symbol: '展开' }}
                              className="!mb-2 !mt-2 !text-[#666666]"
                            >
                              {selectedWorkspace.root_path}
                            </Paragraph>
                            <div className="flex flex-wrap gap-3 text-[12px] text-[#999999]">
                              <span>最近扫描：{formatDateTime(selectedWorkspace.last_scan_at)}</span>
                              <span>最近准备：{formatDateTime(selectedWorkspace.last_prepare_at)}</span>
                            </div>
                            {selectedWorkspace.last_error && (
                              <div className="mt-2 rounded-xl border border-[#F7D5D9] bg-[#FFF2F4] px-3 py-2 text-[12px] text-[#B5455D]">
                                {selectedWorkspace.last_error}
                              </div>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="large"
                              className="border-[#E5E5E4] bg-white text-[#1F1F1F]"
                              icon={<HiOutlineWindow className="w-4 h-4" />}
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
                              size="large"
                              danger
                              icon={<HiOutlineTrash className="w-4 h-4" />}
                              onClick={() => setDeleteWorkspaceId(selectedWorkspace.id)}
                            >
                              移除
                            </Button>
                          </div>
                        </div>

                        <div className="rounded-2xl border border-[#E5E5E4] bg-white p-4">
                          <div className="mb-3 flex items-center gap-2">
                            <Text strong className="!text-[#1F1F1F]">
                              一键准备面板
                            </Text>
                            <Tooltip title="全部差异会补齐新增、变更和删除；仅新增删除跳过内容变更检测；仅变更会重准备已有文件。">
                              <span className="inline-flex cursor-help items-center text-[#999999]">
                                <HiOutlineQuestionMarkCircle className="w-4 h-4" />
                              </span>
                            </Tooltip>
                          </div>
                          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                            <Segmented
                              value={workspaceModes[selectedWorkspace.id] || 'changes_only'}
                              onChange={(value) =>
                                setWorkspaceModes((prev) => ({
                                  ...prev,
                                  [selectedWorkspace.id]: value as WorkspacePrepareMode
                                }))
                              }
                              options={[
                                { label: '全部差异', value: 'full' },
                                { label: '仅新增删除', value: 'presence_only' },
                                { label: '仅变更', value: 'changes_only' }
                              ]}
                              className="bg-[#F5F5F4]"
                            />
                            <div className="flex gap-2">
                              <Button
                                size="large"
                                icon={<HiArrowPath className="w-4 h-4" />}
                                onClick={() => void handleWorkspaceScan(selectedWorkspace)}
                                loading={workspaceActions[selectedWorkspace.id] === 'scan'}
                                className="border-[#E5E5E4] bg-white text-[#1F1F1F]"
                              >
                                先扫描
                              </Button>
                              <Button
                                type="primary"
                                size="large"
                                icon={<HiSparkles className="w-4 h-4" />}
                                onClick={() => void handleWorkspacePrepare(selectedWorkspace)}
                                loading={workspaceActions[selectedWorkspace.id] === 'prepare'}
                              >
                                开始准备
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="mb-3 flex items-center justify-between">
                        <div>
                          <Text strong className="!text-[#1F1F1F]">
                            目录树快照
                          </Text>
                          <div className="text-[12px] text-[#999999]">
                            {selectedWorkspaceTreeStrategy.helperText}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-[12px] text-[#999999]">
                          {selectedWorkspaceTreeStrategy.isLargeTree && (
                            <Tag className="!mr-0 rounded-full border-[#FDECC8] bg-[#FFF9ED] text-[#AD7B18]">
                              大目录策略
                            </Tag>
                          )}
                          <span>文件 {getWorkspaceStats(selectedWorkspaceNodes).fileCount} 个</span>
                        </div>
                      </div>

                      {workspaceActions[selectedWorkspace.id] && (
                        <Alert
                          showIcon
                          icon={<HiOutlineExclamationCircle className="w-4 h-4" />}
                          className="!mb-3 rounded-2xl border-[#F4E5DF] bg-[#FBF5F2] text-[#666666]"
                          message="扫描或准备进行中"
                          description="当前目录树仍展示上一次成功扫描的快照；任务结束后会自动刷新成最新状态。"
                        />
                      )}

                      <div className="mb-3 flex flex-wrap gap-2">
                        <Button
                          size="small"
                          className="border-[#E5E5E4] bg-white text-[#1F1F1F]"
                          onClick={() =>
                            setWorkspaceExpandedKeys((prev) => ({
                              ...prev,
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
                            setWorkspaceExpandedKeys((prev) => ({
                              ...prev,
                              [selectedWorkspace.id]: []
                            }))
                          }
                        >
                          全部折叠
                        </Button>
                      </div>

                      <div className="min-h-[380px] flex-1 overflow-auto rounded-2xl border border-[#E5E5E4] bg-white p-3">
                        {selectedWorkspaceNodes.length > 0 ? (
                          <Tree
                            blockNode
                            height={520}
                            virtual
                            treeData={selectedWorkspaceTree}
                            expandedKeys={workspaceExpandedKeys[selectedWorkspace.id] || []}
                            onExpand={(expandedKeys) =>
                              setWorkspaceExpandedKeys((prev) => ({
                                ...prev,
                                [selectedWorkspace.id]: expandedKeys.map((item) => String(item))
                              }))
                            }
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center">
                            <Empty
                              image={Empty.PRESENTED_IMAGE_SIMPLE}
                              description={<span className="text-[#666666]">当前工作空间没有可追踪文件</span>}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex h-full min-h-[420px] items-center justify-center rounded-2xl border border-dashed border-[#D4D4D3] bg-white">
                      <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description={<span className="text-[#666666]">选择一个工作空间查看目录树和准备面板</span>}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>

          <section className="rounded-3xl border border-[#E5E5E4] bg-white p-6 shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
            <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <HiGlobeAlt className="w-5 h-5 text-[#D97757]" />
                  <Title level={4} className="!mb-0 !text-[#1F1F1F]">
                    网页资料
                  </Title>
                </div>
                <Text className="text-[#666666]">
                  保留网页导入能力，便于把站点内容纳入统一参考范围；重复导入相同 URL 会刷新同一资料来源。
                </Text>
              </div>
              <Button
                type="primary"
                size="large"
                icon={<HiGlobeAlt className="w-4 h-4" />}
                onClick={() => setWebModalVisible(true)}
              >
                添加网页
              </Button>
            </div>

            <Input.Search
              size="large"
              placeholder="按标题或 URL 过滤网页资料"
              value={webKeyword}
              onChange={(event) => setWebKeyword(event.target.value)}
              onSearch={() => void loadWebSources()}
              className="mb-4"
            />

            <div className="min-h-[620px] rounded-2xl border border-[#E5E5E4] bg-[#FAFAF9] p-3">
              <List
                loading={webLoading}
                dataSource={webSources}
                locale={{
                  emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无网页资料" />
                }}
                renderItem={(item) => {
                  const statusMeta = getWebStatusMeta(item.import_status)
                  return (
                    <List.Item className="!border-none !px-0 !py-2">
                      <div className="w-full rounded-2xl border border-[#E5E5E4] bg-white p-4 transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_4px_16px_rgba(0,0,0,0.08)]">
                        <div className="mb-3 flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <HiGlobeAlt className="w-4 h-4 text-[#D97757]" />
                              <Text strong className="!text-[#1F1F1F]">
                                {item.title || item.url}
                              </Text>
                            </div>
                            <Link
                              ellipsis
                              className="mt-2 !block !text-[#D97757]"
                              onClick={async () => {
                                const response = await window.api.openExternal(item.url)
                                if (!response.success) {
                                  message.error(response.error || '打开链接失败')
                                }
                              }}
                            >
                              {item.url}
                            </Link>
                            <div className="mt-2 flex flex-wrap gap-3 text-[12px] text-[#999999]">
                              <span>规范化标识：{item.normalized_url}</span>
                              <span>最近抓取：{formatDateTime(item.fetched_at)}</span>
                            </div>
                            {item.last_error && (
                              <div className="mt-2 rounded-xl border border-[#F7D5D9] bg-[#FFF2F4] px-3 py-2 text-[12px] text-[#B5455D]">
                                {item.last_error}
                              </div>
                            )}
                          </div>
                          <Tag className={`!mr-0 rounded-full ${statusMeta.className}`}>
                            {statusMeta.label}
                          </Tag>
                        </div>
                        <div className="flex items-center justify-between text-[12px] text-[#999999]">
                          <span>创建于 {formatDateTime(item.created_at)}</span>
                          <div className="flex gap-2">
                            <Button
                              size="small"
                              icon={<HiArrowPath className="w-4 h-4" />}
                              className="border-[#E5E5E4] bg-white text-[#1F1F1F]"
                              onClick={() => void handleRefreshWebSource(item)}
                            >
                              刷新
                            </Button>
                            <Button
                              size="small"
                              danger
                              icon={<HiOutlineTrash className="w-4 h-4" />}
                              onClick={() => setDeleteWebSource(item)}
                            >
                              删除
                            </Button>
                          </div>
                        </div>
                      </div>
                    </List.Item>
                  )
                }}
              />
            </div>
          </section>
        </div>
      </div>

      <Modal
        title="添加工作空间"
        open={createVisible}
        confirmLoading={createSubmitting}
        onCancel={() => setCreateVisible(false)}
        onOk={handleCreateWorkspace}
        okText="保存"
        cancelText="取消"
      >
        <div className="space-y-4 pt-2">
          <div>
            <div className="mb-2 text-sm font-medium text-[#1F1F1F]">根路径</div>
            <Input
              size="large"
              value={createRootPath}
              onChange={(event) => setCreateRootPath(event.target.value)}
              placeholder="/absolute/path/to/workspace"
            />
            <div className="mt-2 text-[12px] text-[#999999]">
              请输入本机上的绝对路径。系统会基于真实路径做重复和嵌套校验。
            </div>
          </div>
          <div>
            <div className="mb-2 text-sm font-medium text-[#1F1F1F]">显示名称</div>
            <Input
              size="large"
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
              placeholder="可选，默认取目录名"
            />
          </div>
        </div>
      </Modal>

      <Modal
        title="导入网页资料"
        open={webModalVisible}
        confirmLoading={webSubmitting}
        onCancel={() => setWebModalVisible(false)}
        onOk={handleWebImport}
        okText="提交"
        cancelText="取消"
      >
        <div className="space-y-4 pt-2">
          <div>
            <div className="mb-2 text-sm font-medium text-[#1F1F1F]">URL</div>
            <Input.TextArea
              value={webUrlsText}
              onChange={(event) => setWebUrlsText(event.target.value)}
              placeholder="每行一个 URL"
              autoSize={{ minRows: 4, maxRows: 8 }}
            />
          </div>
          <div>
            <div className="mb-2 text-sm font-medium text-[#1F1F1F]">Include Selectors</div>
            <Input.TextArea
              value={webIncludeSelectorsText}
              onChange={(event) => setWebIncludeSelectorsText(event.target.value)}
              placeholder="可选，逗号或换行分隔"
              autoSize={{ minRows: 2, maxRows: 4 }}
            />
          </div>
          <div>
            <div className="mb-2 text-sm font-medium text-[#1F1F1F]">Exclude Selectors</div>
            <Input.TextArea
              value={webExcludeSelectorsText}
              onChange={(event) => setWebExcludeSelectorsText(event.target.value)}
              placeholder="可选，逗号或换行分隔"
              autoSize={{ minRows: 2, maxRows: 4 }}
            />
          </div>
        </div>
      </Modal>

      <Modal
        title="移除工作空间"
        open={Boolean(deleteWorkspaceId)}
        onCancel={() => setDeleteWorkspaceId(null)}
        onOk={() => void handleDeleteWorkspace()}
        okText="移除"
        okButtonProps={{ danger: true }}
        cancelText="取消"
      >
        <Paragraph className="!mb-0 !text-[#666666]">
          移除后，该工作空间将不再出现在资料来源和聊天范围里。若仍需使用，请重新添加并重新准备。
        </Paragraph>
      </Modal>

      <Modal
        title="删除网页资料"
        open={Boolean(deleteWebSource)}
        onCancel={() => setDeleteWebSource(null)}
        onOk={() => void handleDeleteWebSource()}
        okText="删除"
        okButtonProps={{ danger: true }}
        cancelText="取消"
      >
        <Paragraph className="!mb-0 !text-[#666666]">
          {deleteWebSource?.title || deleteWebSource?.url
            ? `将删除网页资料「${deleteWebSource?.title || deleteWebSource?.url}」。`
            : '将删除该网页资料。'}
        </Paragraph>
      </Modal>
    </div>
  )
}

export default ImportPage
