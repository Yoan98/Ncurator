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
import type { WebSourceRecord, WorkspaceSource, WorkspaceTreeEntry } from '../../../../../shared/types'
import { WEB_SOURCE_STATUS_META, WORKSPACE_STATUS_META } from '../constants'
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

export const getWebStatusMeta = (
  status: WebSourceRecord['import_status']
): { label: string; className: string } => {
  return WEB_SOURCE_STATUS_META[status]
}

export const getTreeEntryStatusMeta = (
  entry: WorkspaceTreeEntry
): { label: string; className: string } | null => {
  if (entry.kind !== 'file' || !entry.supported_for_index) return null
  switch (entry.index_status) {
    case 'indexing':
      return { label: '索引中', className: 'border-[#FDE2D8] bg-[#FFF3EE] text-[#C66A4A]' }
    case 'indexed':
      return { label: '已索引', className: 'border-[#DCEBD7] bg-[#F3FAF0] text-[#4F7A46]' }
    case 'needs_update':
      return { label: '需更新', className: 'border-[#FDECC8] bg-[#FFF9ED] text-[#AD7B18]' }
    case 'failed':
      return { label: '失败', className: 'border-[#F7D5D9] bg-[#FFF2F4] text-[#B5455D]' }
    default:
      return { label: '未索引', className: 'border-[#E5E5E4] bg-[#F8F8F7] text-[#666666]' }
  }
}

export const getWorkspaceStatusBadge = (input: WorkspaceStatusBadgeInput): StatusBadgeVisual => {
  if (
    input.action === 'scan' ||
    input.status === 'scanning' ||
    input.progress?.phase === 'scan' ||
    input.progress?.phase === 'inspect'
  ) {
    return {
      ...getWorkspaceStatusMeta('scanning'),
      tooltip: input.progress?.message || '正在检查目录变化，请稍候。',
      icon: <HiArrowPath className={STATUS_SPIN_ICON_CLASSNAME} />
    }
  }

  if (
    input.action === 'prepare' ||
    input.status === 'preparing' ||
    input.progress?.phase === 'prepare' ||
    input.progress?.phase === 'index'
  ) {
    return {
      ...getWorkspaceStatusMeta('preparing'),
      tooltip: input.progress?.message || '正在更新索引，请稍候。',
      icon: <HiArrowPath className={STATUS_SPIN_ICON_CLASSNAME} />
    }
  }

  if (input.status === 'prepared') {
    return {
      ...getWorkspaceStatusMeta('prepared'),
      tooltip: `最近索引：${formatDateTime(input.lastPrepareAt)}`,
      icon: <HiCheckCircle className={STATUS_ICON_CLASSNAME} />
    }
  }

  if (input.status === 'stale') {
    return {
      ...getWorkspaceStatusMeta('stale'),
      tooltip: '检测到目录变化，建议更新索引。',
      icon: <HiOutlineClock className={STATUS_ICON_CLASSNAME} />
    }
  }

  if (input.status === 'failed') {
    return {
      ...getWorkspaceStatusMeta('failed'),
      tooltip: input.lastError || '最近一次索引失败。',
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
    tooltip: input.lastScanAt ? `最近检查：${formatDateTime(input.lastScanAt)}` : '尚未建立索引。',
    icon: <HiOutlineClock className={STATUS_ICON_CLASSNAME} />
  }
}

export const getWorkspaceActionTooltip = (
  action: 'scan' | 'prepare',
  progress?: WorkspaceStatusBadgeInput['progress']
): string => {
  if (action === 'scan') {
    return progress?.message || '检查当前目录里有哪些新增、变更或删除。'
  }
  return progress?.message || '检查目录变化并更新可索引文件。'
}

const isHiddenPathSegment = (value: string): boolean =>
  value
    .split('/')
    .filter(Boolean)
    .some((segment) => segment.startsWith('.'))

export const getVisibleWorkspaceTreeEntries = (
  entries: WorkspaceTreeEntry[]
): WorkspaceTreeEntry[] => entries.filter((entry) => !isHiddenPathSegment(entry.relative_path))

export const createWorkspaceTree = (entries: WorkspaceTreeEntry[]): WorkspaceTreeNode[] => {
  const sortedEntries = [...entries].sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === 'directory' ? -1 : 1
    }
    return left.relative_path.localeCompare(right.relative_path)
  })

  const nodeMap = new Map<string, WorkspaceTreeNode>()
  const roots: WorkspaceTreeNode[] = []

  sortedEntries.forEach((entry) => {
    const statusMeta = getTreeEntryStatusMeta(entry)
    const treeNode: WorkspaceTreeNode = {
      key: entry.id,
      title: (
        <div className="flex min-w-0 items-center gap-2 py-1">
          {entry.kind === 'directory' ? (
            <HiFolder className="h-4 w-4 text-[#D97757]" />
          ) : (
            <HiDocumentText
              className={`h-4 w-4 ${entry.supported_for_index ? 'text-[#666666]' : 'text-[#C9C7C3]'}`}
            />
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] text-[#1F1F1F]">{entry.name}</div>
            <div className="truncate text-[12px] text-[#999999]">
              {entry.relative_path || entry.absolute_path}
            </div>
          </div>
          {entry.kind === 'file' ? (
            entry.supported_for_index && statusMeta ? (
              <Tag className={`!mr-0 rounded-full ${statusMeta.className}`}>{statusMeta.label}</Tag>
            ) : (
              <Tag className="!mr-0 rounded-full border-[#E5E5E4] bg-[#F8F8F7] text-[#999999]">
                不支持
              </Tag>
            )
          ) : null}
        </div>
      ),
      children: []
    }
    nodeMap.set(entry.id, treeNode)
  })

  sortedEntries.forEach((entry) => {
    const treeNode = nodeMap.get(entry.id)
    if (!treeNode) return
    if (entry.parent_id && nodeMap.has(entry.parent_id)) {
      const parentNode = nodeMap.get(entry.parent_id)
      parentNode?.children?.push(treeNode)
      return
    }
    roots.push(treeNode)
  })

  return roots
}

export const getWorkspaceTreeDisplayStrategy = (
  entries: WorkspaceTreeEntry[]
): WorkspaceTreeDisplayStrategy => {
  const directoryCount = entries.filter((entry) => entry.kind === 'directory').length
  const totalNodes = entries.length
  if (totalNodes >= 800 || directoryCount >= 220) {
    return {
      defaultExpandDepth: 1,
      isLargeTree: true,
      helperText: '大型目录默认仅展开首层，深层目录按需查看。'
    }
  }
  return {
    defaultExpandDepth: 2,
    isLargeTree: totalNodes >= 260 || directoryCount >= 80,
    helperText: '默认展开前两层目录。'
  }
}

export const getDefaultExpandedKeys = (entries: WorkspaceTreeEntry[], depth: number): string[] =>
  entries
    .filter((entry) => entry.kind === 'directory' && entry.relative_path.split('/').length <= depth)
    .map((entry) => entry.id)

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
