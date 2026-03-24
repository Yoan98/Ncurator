import { Tag } from 'antd'
import { HiDocumentText, HiFolder } from 'react-icons/hi2'
import type { WebSourceRecord, WorkspaceNode, WorkspaceSource } from '../../../../../shared/types'
import {
  WEB_SOURCE_STATUS_META,
  WORKSPACE_NODE_STATUS_META,
  WORKSPACE_STATUS_META
} from '../constants'
import type { WorkspaceTreeDisplayStrategy, WorkspaceTreeNode } from '../types'

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
