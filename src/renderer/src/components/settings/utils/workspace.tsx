import { Tag } from 'antd'
import {
  HiArrowPath,
  HiCheckCircle,
  HiDocumentText,
  HiExclamationTriangle,
  HiFolder,
  HiOutlineClock,
  HiOutlineExclamationCircle
} from 'react-icons/hi2'
import type { WebSourceRecord, WorkspaceNode, WorkspaceSource } from '../../../../../shared/types'
import {
  WEB_SOURCE_STATUS_META,
  WORKSPACE_NODE_STATUS_META,
  WORKSPACE_STATUS_META
} from '../constants'
import type {
  StatusBadgeVisual,
  WorkspaceStatusBadgeInput,
  WorkspaceTreeDisplayStrategy,
  WorkspaceTreeNode
} from '../types'

const STATUS_SPIN_ICON_CLASSNAME = 'h-3.5 w-3.5 animate-spin'
const STATUS_ICON_CLASSNAME = 'h-3.5 w-3.5'

export const formatDateTime = (value?: number): string => {
  if (!value) return '未执行'
  return new Date(value).toLocaleString('zh-CN', {
    hour12: false
  })
}

export const getWorkspaceStatusMeta = (
  status: WorkspaceSource['status']
): { label: string; className: string } => {
  return WORKSPACE_STATUS_META[status]
}

export const getNodeStatusMeta = (
  status: WorkspaceNode['prepare_status']
): { label: string; className: string } => {
  return WORKSPACE_NODE_STATUS_META[status]
}

export const getWebStatusMeta = (
  status: WebSourceRecord['import_status']
): { label: string; className: string } => {
  return WEB_SOURCE_STATUS_META[status]
}

export const getWorkspaceStatusBadge = (input: WorkspaceStatusBadgeInput): StatusBadgeVisual => {
  if (
    input.action === 'scan' ||
    input.status === 'scanning' ||
    input.progress?.phase === 'scan' ||
    input.progress?.phase === 'diff'
  ) {
    return {
      ...getWorkspaceStatusMeta('scanning'),
      tooltip: input.progress?.message || '正在刷新目录快照，请稍候。',
      icon: <HiArrowPath className={STATUS_SPIN_ICON_CLASSNAME} />
    }
  }

  if (
    input.action === 'prepare' ||
    input.status === 'preparing' ||
    input.progress?.phase === 'prepare'
  ) {
    return {
      ...getWorkspaceStatusMeta('preparing'),
      tooltip: input.progress?.message || '正在准备工作空间资料，请稍候。',
      icon: <HiArrowPath className={STATUS_SPIN_ICON_CLASSNAME} />
    }
  }

  if (input.status === 'prepared') {
    return {
      ...getWorkspaceStatusMeta('prepared'),
      tooltip: `最近准备：${formatDateTime(input.lastPrepareAt)}`,
      icon: <HiCheckCircle className={STATUS_ICON_CLASSNAME} />
    }
  }

  if (input.status === 'stale') {
    return {
      ...getWorkspaceStatusMeta('stale'),
      tooltip: '目录有变更，建议先扫描或重新准备。',
      icon: <HiOutlineClock className={STATUS_ICON_CLASSNAME} />
    }
  }

  if (input.status === 'failed') {
    return {
      ...getWorkspaceStatusMeta('failed'),
      tooltip: input.lastError || '最近一次扫描或准备失败。',
      icon: <HiOutlineExclamationCircle className={STATUS_ICON_CLASSNAME} />
    }
  }

  if (input.status === 'unavailable') {
    return {
      ...getWorkspaceStatusMeta('unavailable'),
      tooltip: input.lastError || '当前工作空间路径不可用。',
      icon: <HiExclamationTriangle className={STATUS_ICON_CLASSNAME} />
    }
  }

  return {
    ...getWorkspaceStatusMeta('not_prepared'),
    tooltip: input.lastScanAt
      ? `最近扫描：${formatDateTime(input.lastScanAt)}`
      : '尚未扫描或准备该工作空间。',
    icon: <HiOutlineClock className={STATUS_ICON_CLASSNAME} />
  }
}

export const getWorkspaceActionTooltip = (
  action: 'scan' | 'prepare',
  progress?: WorkspaceStatusBadgeInput['progress']
): string => {
  if (action === 'scan') {
    return progress?.message || '刷新目录快照，并同步当前目录树状态。'
  }
  return progress?.message || '根据当前策略准备工作空间资料。'
}

export const getWebStatusBadge = (
  source: Pick<WebSourceRecord, 'import_status' | 'fetched_at' | 'last_error'>,
  isRefreshing: boolean
): StatusBadgeVisual => {
  if (isRefreshing || source.import_status === 1) {
    return {
      ...getWebStatusMeta(1),
      tooltip: isRefreshing ? '正在重新抓取网页资料，请稍候。' : '网页资料正在抓取中。',
      icon: <HiArrowPath className={STATUS_SPIN_ICON_CLASSNAME} />
    }
  }

  if (source.import_status === 2) {
    return {
      ...getWebStatusMeta(2),
      tooltip: `最近抓取：${formatDateTime(source.fetched_at)}`,
      icon: <HiCheckCircle className={STATUS_ICON_CLASSNAME} />
    }
  }

  return {
    ...getWebStatusMeta(3),
    tooltip: source.last_error || '最近一次抓取失败。',
    icon: <HiOutlineExclamationCircle className={STATUS_ICON_CLASSNAME} />
  }
}

export const getWorkspaceStats = (nodes: WorkspaceNode[]) => {
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

export const createWorkspaceTree = (nodes: WorkspaceNode[]): WorkspaceTreeNode[] => {
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
            <HiFolder className="h-4 w-4 text-[#D97757]" />
          ) : (
            <HiDocumentText className="h-4 w-4 text-[#666666]" />
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] text-[#1F1F1F]">{node.name}</div>
            <div className="truncate text-[12px] text-[#999999]">
              {node.relative_path || node.absolute_path}
            </div>
          </div>
          {node.kind === 'file' ? (
            <Tag className={`!mr-0 rounded-full ${statusMeta.className}`}>{statusMeta.label}</Tag>
          ) : null}
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

export const getWorkspaceTreeDisplayStrategy = (
  nodes: WorkspaceNode[]
): WorkspaceTreeDisplayStrategy => {
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

export const getDefaultExpandedKeys = (nodes: WorkspaceNode[], depth: number): string[] =>
  nodes
    .filter((node) => node.kind === 'directory' && node.relative_path.split('/').length <= depth)
    .map((node) => node.id)

export const parseSelectors = (input: string): string[] | undefined => {
  const values = input
    .split(/[\n,]/g)
    .map((item) => item.trim())
    .filter(Boolean)
  return values.length > 0 ? values : undefined
}
