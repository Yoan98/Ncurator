import { Tag } from 'antd'
import {
  HiArrowPath,
  HiCheckCircle,
  HiDocumentText,
  HiFolder,
  HiOutlineClock,
  HiOutlineExclamationCircle
} from 'react-icons/hi2'
import type { WebSourceRecord, WorkspaceTreeEntry } from '../../../../../shared/types'
import type {
  StatusBadgeVisual,
  WorkspaceTreeDisplayStrategy,
  WorkspaceTreeNode
} from '../types'

const STATUS_SPIN_ICON_CLASSNAME = 'h-3.5 w-3.5 animate-spin'
const STATUS_ICON_CLASSNAME = 'h-3.5 w-3.5'

export const formatDateTime = (value?: number): string => {
  if (!value) return '暂无记录'
  return new Date(value).toLocaleString('zh-CN', {
    hour12: false
  })
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
    case 'failed':
      return { label: '失败', className: 'border-[#F7D5D9] bg-[#FFF2F4] text-[#B5455D]' }
    default:
      return { label: '需索引', className: 'border-[#E5E5E4] bg-[#F8F8F7] text-[#666666]' }
  }
}

export const getWorkspaceActionTooltip = (
  action: 'scan' | 'prepare',
  progress?: { message?: string }
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
  source: Pick<WebSourceRecord, 'index_status' | 'last_indexed_at' | 'last_error'>,
  isRefreshing: boolean
): StatusBadgeVisual => {
  if (isRefreshing || source.index_status === 'crawling') {
    return {
      label: '爬取中',
      className: 'border-[#FDE2D8] bg-[#FFF3EE] text-[#C66A4A]',
      tooltip: '正在爬取网页正文。',
      icon: <HiArrowPath className={STATUS_SPIN_ICON_CLASSNAME} />
    }
  }

  if (source.index_status === 'indexing') {
    return {
      label: '索引中',
      className: 'border-[#FDE2D8] bg-[#FFF3EE] text-[#C66A4A]',
      tooltip: '正在建立网页索引。',
      icon: <HiArrowPath className={STATUS_SPIN_ICON_CLASSNAME} />
    }
  }

  if (source.index_status === 'indexed') {
    return {
      label: '已索引',
      className: 'border-[#DCEBD7] bg-[#F3FAF0] text-[#4F7A46]',
      tooltip: `最近索引：${formatDateTime(source.last_indexed_at)}`,
      icon: <HiCheckCircle className={STATUS_ICON_CLASSNAME} />
    }
  }

  if (source.index_status === 'crawl_failed') {
    return {
      label: '爬取失败',
      className: 'border-[#F7D5D9] bg-[#FFF2F4] text-[#B5455D]',
      tooltip: source.last_error || '最近一次网页爬取失败。',
      icon: <HiOutlineExclamationCircle className={STATUS_ICON_CLASSNAME} />
    }
  }

  if (source.index_status === 'index_failed') {
    return {
      label: '索引失败',
      className: 'border-[#F7D5D9] bg-[#FFF2F4] text-[#B5455D]',
      tooltip: source.last_error || '最近一次网页索引失败。',
      icon: <HiOutlineExclamationCircle className={STATUS_ICON_CLASSNAME} />
    }
  }

  return {
    label: '需索引',
    className: 'border-[#FDECC8] bg-[#FFF9ED] text-[#AD7B18]',
    tooltip: '网页需要建立或更新索引。',
    icon: <HiOutlineClock className={STATUS_ICON_CLASSNAME} />
  }
}
