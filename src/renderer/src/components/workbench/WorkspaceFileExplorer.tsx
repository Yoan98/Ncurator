import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  HiChevronDown,
  HiChevronRight,
  HiDocumentText,
  HiFolder,
  HiOutlineMagnifyingGlass,
  HiArrowsRightLeft
} from 'react-icons/hi2'
import type {
  AiFileChangeRecord,
  WorkspaceSource,
  WorkspaceTreeEntry
} from '../../../../shared/types'

type WorkspaceFileExplorerProps = {
  workspace: WorkspaceSource | null
  changeRecords: AiFileChangeRecord[]
  onOpenFile: (entry: WorkspaceTreeEntry, change?: AiFileChangeRecord) => void
}

const normalizePath = (value: string): string =>
  value.replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase()

const WorkspaceFileExplorer: React.FC<WorkspaceFileExplorerProps> = ({
  workspace,
  changeRecords,
  onOpenFile
}) => {
  const [childrenByPath, setChildrenByPath] = useState<Record<string, WorkspaceTreeEntry[]>>({})
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [loading, setLoading] = useState<Set<string>>(() => new Set())
  const [query, setQuery] = useState('')

  const changesByPath = useMemo(() => {
    const map = new Map<string, AiFileChangeRecord>()
    ;[...changeRecords]
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .forEach((record) => {
        const key = normalizePath(record.path)
        if (!map.has(key) && record.status === 'applied') map.set(key, record)
      })
    return map
  }, [changeRecords])

  const loadDirectory = useCallback(
    async (relativePath: string): Promise<void> => {
      if (!workspace) return
      setLoading((current) => new Set(current).add(relativePath))
      const response = await window.api.workspaceDirectoryList({
        workspaceId: workspace.id,
        relativePath
      })
      setLoading((current) => {
        const next = new Set(current)
        next.delete(relativePath)
        return next
      })
      setChildrenByPath((current) => ({ ...current, [relativePath]: response.items }))
    },
    [workspace]
  )

  useEffect(() => {
    setChildrenByPath({})
    setExpanded(new Set())
    if (workspace) void loadDirectory('')
  }, [loadDirectory, workspace])

  const toggleDirectory = (entry: WorkspaceTreeEntry): void => {
    const path = entry.relative_path
    setExpanded((current) => {
      const next = new Set(current)
      next.has(path) ? next.delete(path) : next.add(path)
      return next
    })
    void loadDirectory(path)
  }

  const renderEntries = (parentPath: string, depth: number): React.ReactNode => {
    const entries = childrenByPath[parentPath] || []
    const normalizedQuery = query.trim().toLowerCase()
    return entries.map((entry) => {
      const isDirectory = entry.kind === 'directory'
      const isExpanded = expanded.has(entry.relative_path)
      const change = changesByPath.get(normalizePath(entry.absolute_path))
      const visible =
        !normalizedQuery || entry.relative_path.toLowerCase().includes(normalizedQuery)
      return (
        <React.Fragment key={entry.id}>
          <button
            type="button"
            className={`group flex h-7 w-full items-center gap-1.5 pr-2 text-left text-[13px] transition-colors hover:bg-[#F4F4F2] ${visible ? '' : 'hidden'}`}
            style={{ paddingLeft: 8 + depth * 14 }}
            title={entry.relative_path}
            onClick={() => (isDirectory ? toggleDirectory(entry) : onOpenFile(entry, change))}
          >
            <span className="flex h-5 w-4 shrink-0 items-center justify-center text-[#91918E]">
              {isDirectory ? (
                isExpanded ? (
                  <HiChevronDown className="h-4 w-4" />
                ) : (
                  <HiChevronRight className="h-4 w-4" />
                )
              ) : null}
            </span>
            {isDirectory ? (
              <HiFolder className="h-4 w-4 shrink-0 text-[#787774]" />
            ) : (
              <HiDocumentText className="h-4 w-4 shrink-0 text-[#91918E]" />
            )}
            <span className="min-w-0 flex-1 truncate text-[#37352F]">{entry.name}</span>
            {change ? (
              <span title="查看当前会话中的 AI 修改">
                <HiArrowsRightLeft className="h-4 w-4 shrink-0 text-[#2F5F8F]" />
              </span>
            ) : null}
          </button>
          {isDirectory && isExpanded ? renderEntries(entry.relative_path, depth + 1) : null}
        </React.Fragment>
      )
    })
  }

  if (!workspace?.root_path) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-[#91918E]">
        请先为当前工作区设置文件目录
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col border-l border-[#EEEEEC] bg-white">
      <div className="shrink-0 p-2">
        <label className="flex h-8 items-center gap-2 rounded-[7px] border border-[#E0DFDC] px-2.5 text-[#91918E]">
          <HiOutlineMagnifyingGlass className="h-4 w-4 shrink-0" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="筛选文件…"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-[#37352F] outline-none placeholder:text-[#9B9A97]"
          />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-auto pb-2">
        {loading.has('') && !childrenByPath[''] ? (
          <div className="px-3 py-2 text-xs text-[#91918E]">正在读取文件…</div>
        ) : (
          renderEntries('', 0)
        )}
      </div>
    </div>
  )
}

export default WorkspaceFileExplorer
