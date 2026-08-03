import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  HiChevronDown,
  HiChevronRight,
  HiDocumentText,
  HiFolder,
  HiOutlineMagnifyingGlass
} from 'react-icons/hi2'
import type {
  AiFileChangeRecord,
  WorkspaceSource,
  WorkspaceTreeEntry
} from '../../../../shared/types'
import ChangeCountBadges from './ChangeCountBadges'
import { workbenchSelectors } from '../../testing/selectors'
import {
  groupSessionFileChanges,
  normalizeFileChangePath as normalizePath
} from './fileChangeGroups'

export type WorkspaceFileExplorerMode = 'all' | 'changed'

type WorkspaceFileExplorerProps = {
  workspace: WorkspaceSource | null
  changeRecords: AiFileChangeRecord[]
  mode: WorkspaceFileExplorerMode
  activeFilePath?: string | null
  activeChangeId?: string | null
  onModeChange: (mode: WorkspaceFileExplorerMode) => void
  onOpenFile: (entry: WorkspaceTreeEntry) => void
  onOpenChange: (change: AiFileChangeRecord) => void
}

const getRelativePath = (workspace: WorkspaceSource | null, filePath: string): string => {
  const root = normalizePath(workspace?.root_path || '')
  const normalized = filePath.replace(/\\/g, '/')
  return root && normalizePath(normalized).startsWith(`${root}/`)
    ? normalized.slice(
        (workspace?.root_path || '').replace(/\\/g, '/').replace(/\/+$/g, '').length + 1
      )
    : normalized
}

const WorkspaceFileExplorer: React.FC<WorkspaceFileExplorerProps> = ({
  workspace,
  changeRecords,
  mode,
  activeFilePath,
  activeChangeId,
  onModeChange,
  onOpenFile,
  onOpenChange
}) => {
  const [childrenByPath, setChildrenByPath] = useState<Record<string, WorkspaceTreeEntry[]>>({})
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [expandedChangeGroups, setExpandedChangeGroups] = useState<Set<string>>(() => new Set())
  const [loading, setLoading] = useState<Set<string>>(() => new Set())
  const [query, setQuery] = useState('')

  const activeChanges = useMemo(() => groupSessionFileChanges(changeRecords), [changeRecords])

  const changesByPath = useMemo(() => {
    const map = new Map<string, AiFileChangeRecord>()
    activeChanges.forEach(({ latest, paths }) => {
      paths.forEach((value) => map.set(value, latest))
    })
    return map
  }, [activeChanges])

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
    setExpandedChangeGroups(new Set())
    if (workspace) void loadDirectory('')
  }, [loadDirectory, workspace])

  const toggleDirectory = (entry: WorkspaceTreeEntry): void => {
    const entryPath = entry.relative_path
    setExpanded((current) => {
      const next = new Set(current)
      next.has(entryPath) ? next.delete(entryPath) : next.add(entryPath)
      return next
    })
    void loadDirectory(entryPath)
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
      const selected =
        !isDirectory &&
        Boolean(activeFilePath) &&
        normalizePath(entry.absolute_path) === normalizePath(activeFilePath || '')
      return (
        <React.Fragment key={entry.id}>
          <button
            type="button"
            className={`relative flex h-7 w-full items-center gap-1.5 pr-2 text-left text-[13px] transition-colors ${
              selected
                ? 'bg-[#EEEEEB] font-medium text-[#2F2E2A] before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:bg-[#787774]'
                : 'text-[#57554F] hover:bg-[#F4F4F2]'
            } ${visible ? '' : 'hidden'}`}
            style={{ paddingLeft: 8 + depth * 14 }}
            title={entry.relative_path}
            aria-current={selected ? 'page' : undefined}
            onClick={() => (isDirectory ? toggleDirectory(entry) : onOpenFile(entry))}
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
            <span className="min-w-0 flex-1 truncate">{entry.name}</span>
            {change ? (
                <span title="当前运行中已修改">
                {change.insertCount > 0 || change.deleteCount > 0 ? (
                  <ChangeCountBadges
                    insertCount={change.insertCount}
                    deleteCount={change.deleteCount}
                    mode="compact"
                  />
                ) : (
                  <span className="text-[11px] font-medium text-[#787774]">已改</span>
                )}
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

  const normalizedQuery = query.trim().toLowerCase()
  const filteredChanges = activeChanges.filter(({ latest }) =>
    getRelativePath(workspace, latest.afterPath || latest.beforePath || latest.path)
      .toLowerCase()
      .includes(normalizedQuery)
  )

  return (
    <div className="flex h-full min-h-0 flex-col border-l border-[#EEEEEC] bg-white">
      <div className="shrink-0 px-2 pt-2">
        <div
          className="grid h-8 grid-cols-2 rounded-[6px] bg-[#F3F3F1] p-0.5"
          data-testid={workbenchSelectors.workspaceExplorerModeSwitch}
        >
          <button
            type="button"
            className={`rounded-[5px] text-[12px] font-medium ${mode === 'all' ? 'bg-white text-[#37352F] shadow-sm' : 'text-[#787774] hover:text-[#37352F]'}`}
            onClick={() => onModeChange('all')}
          >
            全部
          </button>
          <button
            type="button"
            className={`rounded-[5px] text-[12px] font-medium ${mode === 'changed' ? 'bg-white text-[#37352F] shadow-sm' : 'text-[#787774] hover:text-[#37352F]'}`}
            onClick={() => onModeChange('changed')}
          >
            本次运行改动 {activeChanges.length}
          </button>
        </div>
      </div>
      <div className="shrink-0 p-2">
        <label className="flex h-8 items-center gap-2 rounded-[6px] border border-[#E0DFDC] px-2.5 text-[#91918E]">
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
        {mode === 'all' ? (
          loading.has('') && !childrenByPath[''] ? (
            <div className="px-3 py-2 text-xs text-[#91918E]">正在读取文件…</div>
          ) : (
            renderEntries('', 0)
          )
        ) : filteredChanges.length > 0 ? (
          filteredChanges.map(({ latest, records, paths }) => {
            const selected =
              records.some((record) => record.id === activeChangeId) ||
              (Boolean(activeFilePath) && paths.has(normalizePath(activeFilePath || '')))
            const isExpanded = expandedChangeGroups.has(latest.id)
            const displayPath = getRelativePath(
              workspace,
              latest.afterPath || latest.beforePath || latest.path
            )
            return (
              <React.Fragment key={latest.id}>
                <button
                  type="button"
                  className={`relative flex h-9 w-full items-center gap-2 px-2 text-left text-[13px] transition-colors ${selected ? 'bg-[#EEEEEB] font-medium text-[#2F2E2A] before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:bg-[#787774]' : 'text-[#57554F] hover:bg-[#F4F4F2]'}`}
                  aria-current={selected ? 'page' : undefined}
                  data-testid={`${workbenchSelectors.workspaceFileChangePrefix}-${latest.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`}
                  onClick={() => onOpenChange(latest)}
                >
                  {records.length > 1 ? (
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={isExpanded ? '收起修改记录' : '展开修改记录'}
                      className="flex h-6 w-4 shrink-0 items-center justify-center text-[#91918E]"
                      onClick={(event) => {
                        event.stopPropagation()
                        setExpandedChangeGroups((current) => {
                          const next = new Set(current)
                          next.has(latest.id) ? next.delete(latest.id) : next.add(latest.id)
                          return next
                        })
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') return
                        event.preventDefault()
                        event.stopPropagation()
                        setExpandedChangeGroups((current) => {
                          const next = new Set(current)
                          next.has(latest.id) ? next.delete(latest.id) : next.add(latest.id)
                          return next
                        })
                      }}
                    >
                      {isExpanded ? (
                        <HiChevronDown className="h-4 w-4" />
                      ) : (
                        <HiChevronRight className="h-4 w-4" />
                      )}
                    </span>
                  ) : null}
                  <HiDocumentText className="h-4 w-4 shrink-0 text-[#91918E]" />
                  <span className="min-w-0 flex-1 truncate" title={displayPath}>
                    {displayPath}
                  </span>
                  {latest.insertCount > 0 || latest.deleteCount > 0 ? (
                    <ChangeCountBadges
                      insertCount={latest.insertCount}
                      deleteCount={latest.deleteCount}
                      mode="compact"
                    />
                  ) : (
                    <span className="shrink-0 text-[11px] text-[#787774]">
                      {latest.operation === 'deleted'
                        ? '已删除'
                        : latest.operation === 'renamed'
                          ? '已重命名'
                          : '已改'}
                    </span>
                  )}
                  {records.length > 1 ? (
                    <span className="shrink-0 text-[11px] tabular-nums text-[#9B9A97]">
                      {records.length} 次
                    </span>
                  ) : null}
                </button>
                {records.length > 1 && isExpanded ? (
                  <div className="border-b border-[#EEEEEC] bg-[#FAFAF9] py-1">
                    {records.map((record, index) => (
                      <button
                        key={record.id}
                        type="button"
                        className={`flex h-8 w-full items-center gap-2 pl-9 pr-2 text-left text-[12px] ${record.id === activeChangeId ? 'bg-[#EEEEEB] text-[#37352F]' : 'text-[#787774] hover:bg-[#F4F4F2]'}`}
                        aria-current={record.id === activeChangeId ? 'page' : undefined}
                        onClick={() => onOpenChange(record)}
                      >
                        <span className="shrink-0">
                          {index === 0 ? '最新' : `第 ${records.length - index} 次`}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          {record.runSummary || '文件修改'}
                        </span>
                        <span className="shrink-0 tabular-nums text-[#9B9A97]">
                          {new Date(record.updatedAt).toLocaleTimeString('zh-CN', {
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </React.Fragment>
            )
          })
        ) : (
          <div className="px-3 py-8 text-center text-xs text-[#91918E]">本会话暂无文件改动</div>
        )}
      </div>
    </div>
  )
}

export default WorkspaceFileExplorer
