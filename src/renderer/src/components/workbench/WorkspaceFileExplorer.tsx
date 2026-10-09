import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { filterVisibleFileChangeRecords } from '../../../../shared/fileChangeVisibility'
import ChangeCountBadges from './ChangeCountBadges'
import WorkspaceFilesEmptyState from './WorkspaceFilesEmptyState'
import type { WorkspaceLoadState } from './types'
import { workbenchSelectors } from '../../testing/selectors'
import {
  groupSessionFileChanges,
  normalizeFileChangePath as normalizePath
} from './fileChangeGroups'

export type WorkspaceFileExplorerMode = 'all' | 'changed'

type WorkspaceFileExplorerProps = {
  workspace: WorkspaceSource | null
  workspaceLoadState: WorkspaceLoadState
  onOpenWorkspaceSettings: () => void
  onReloadWorkspaces: () => void
  changeRecords: AiFileChangeRecord[]
  mode: WorkspaceFileExplorerMode
  /** 递增时重新拉取根目录与当前已展开目录，不折叠展开态 */
  reloadToken?: number
  /** 为 true 时才响应窗口焦点 / 可见性变化并刷新目录 */
  liveRefreshEnabled?: boolean
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
  workspaceLoadState,
  onOpenWorkspaceSettings,
  onReloadWorkspaces,
  changeRecords,
  mode,
  reloadToken = 0,
  liveRefreshEnabled = false,
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
  const [directoryErrors, setDirectoryErrors] = useState<Set<string>>(() => new Set())
  const [query, setQuery] = useState('')
  const directoryRequestIds = useRef<Record<string, number>>({})
  const expandedRef = useRef(expanded)
  const appliedReloadTokenRef = useRef(reloadToken)
  expandedRef.current = expanded

  const activeChanges = useMemo(
    () => groupSessionFileChanges(filterVisibleFileChangeRecords(changeRecords)),
    [changeRecords]
  )

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
      const requestId = (directoryRequestIds.current[relativePath] || 0) + 1
      directoryRequestIds.current[relativePath] = requestId
      const isLatestRequest = (): boolean => directoryRequestIds.current[relativePath] === requestId
      setLoading((current) => new Set(current).add(relativePath))
      try {
        const response = await window.api.workspaceDirectoryList({
          workspaceId: workspace.id,
          relativePath
        })
        if (!isLatestRequest()) return
        if (response.error) throw new Error(response.error)
        setChildrenByPath((current) => ({ ...current, [relativePath]: response.items }))
        setDirectoryErrors((current) => {
          const next = new Set(current)
          next.delete(relativePath)
          return next
        })
      } catch {
        if (isLatestRequest()) {
          setDirectoryErrors((current) => new Set(current).add(relativePath))
        }
      } finally {
        if (isLatestRequest()) {
          setLoading((current) => {
            const next = new Set(current)
            next.delete(relativePath)
            return next
          })
        }
      }
    },
    [workspace]
  )

  const refreshVisibleDirectories = useCallback((): void => {
    if (!workspace) return
    void loadDirectory('')
    for (const relativePath of expandedRef.current) {
      void loadDirectory(relativePath)
    }
  }, [loadDirectory, workspace])

  useEffect(() => {
    directoryRequestIds.current = {}
    appliedReloadTokenRef.current = reloadToken
    setChildrenByPath({})
    setExpanded(new Set())
    setExpandedChangeGroups(new Set())
    setDirectoryErrors(new Set())
    if (workspace) void loadDirectory('')
    // reloadToken 只在工作区切换时同步，避免每次刷新都清空展开态
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when workspace/loader changes
  }, [loadDirectory, workspace])

  useEffect(() => {
    if (!workspace || reloadToken === appliedReloadTokenRef.current) return
    appliedReloadTokenRef.current = reloadToken
    refreshVisibleDirectories()
  }, [reloadToken, refreshVisibleDirectories, workspace])

  useEffect(() => {
    if (!workspace || !liveRefreshEnabled) return
    const refreshOnFocus = (): void => {
      refreshVisibleDirectories()
    }
    const refreshOnVisibility = (): void => {
      if (!document.hidden) refreshVisibleDirectories()
    }
    window.addEventListener('focus', refreshOnFocus)
    document.addEventListener('visibilitychange', refreshOnVisibility)
    return () => {
      window.removeEventListener('focus', refreshOnFocus)
      document.removeEventListener('visibilitychange', refreshOnVisibility)
    }
  }, [liveRefreshEnabled, refreshVisibleDirectories, workspace])

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
      <WorkspaceFilesEmptyState
        loadState={workspaceLoadState}
        onOpenSettings={onOpenWorkspaceSettings}
        onRetry={onReloadWorkspaces}
      />
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
          !childrenByPath[''] ? (
            directoryErrors.has('') && !loading.has('') ? (
              <div className="px-3 py-2 text-xs text-[#91918E]">
                目录读取失败
                <button
                  type="button"
                  className="ml-2 text-[#37352F] underline"
                  onClick={() => void loadDirectory('')}
                >
                  重试
                </button>
              </div>
            ) : (
              <div role="status" className="px-3 py-2 text-xs text-[#91918E]">
                正在读取文件…
              </div>
            )
          ) : childrenByPath[''].length === 0 ? (
            <div className="px-3 py-2 text-xs text-[#91918E]">目录中暂无文件</div>
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
          <div className="px-3 py-8 text-center text-xs text-[#91918E]">本次运行暂无文件改动</div>
        )}
      </div>
    </div>
  )
}

export default WorkspaceFileExplorer
