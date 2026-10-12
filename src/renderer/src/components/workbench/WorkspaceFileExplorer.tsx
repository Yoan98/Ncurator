import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { App, Dropdown, Modal, type MenuProps } from 'antd'
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
import { withTextFileDeletion } from '../fileRenders/pendingTextSaves'
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
  onFileChanged: (filePath: string) => void
}

type NewFileType = 'docx' | 'xlsx' | 'pptx' | 'other'
type NewFileDraft = {
  parentPath: string
  type: NewFileType
  name: string
  extension: string
  error: string | null
}

const getParentPath = (relativePath: string): string =>
  relativePath.split('/').slice(0, -1).join('/')

const newFileTypes: { type: NewFileType; label: string; name: string }[] = [
  { type: 'docx', label: 'Word 文档 (.docx)', name: '新建文档' },
  { type: 'xlsx', label: 'Excel 工作簿 (.xlsx)', name: '新建工作簿' },
  { type: 'pptx', label: 'PPT 演示 (.pptx)', name: '新建演示文稿' },
  { type: 'other', label: '其他类型', name: '新建文件' }
]

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
  onOpenChange,
  onFileChanged
}) => {
  const { message } = App.useApp()
  const [childrenByPath, setChildrenByPath] = useState<Record<string, WorkspaceTreeEntry[]>>({})
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [expandedChangeGroups, setExpandedChangeGroups] = useState<Set<string>>(() => new Set())
  const [loading, setLoading] = useState<Set<string>>(() => new Set())
  const [directoryErrors, setDirectoryErrors] = useState<Set<string>>(() => new Set())
  const [query, setQuery] = useState('')
  const [contextTarget, setContextTarget] = useState<WorkspaceTreeEntry | null>(null)
  const [contextMenuOpen, setContextMenuOpen] = useState(false)
  const [draft, setDraft] = useState<NewFileDraft | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceTreeEntry | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [highlightedPath, setHighlightedPath] = useState<string | null>(null)
  const inputRowRef = useRef<HTMLDivElement | null>(null)
  const nameInputRef = useRef<HTMLInputElement | null>(null)
  const highlightedFileRef = useRef<HTMLButtonElement | null>(null)
  const mutationInFlightRef = useRef(false)
  const workspaceIdRef = useRef(workspace?.id)
  workspaceIdRef.current = workspace?.id
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
      const isLatestRequest = (): boolean =>
        workspaceIdRef.current === workspace.id &&
        directoryRequestIds.current[relativePath] === requestId
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
    setDraft(null)
    setContextMenuOpen(false)
    setDeleteTarget(null)
    setHighlightedPath(null)
    if (workspace) void loadDirectory('')
    // reloadToken 只在工作区切换时同步，避免每次刷新都清空展开态
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when workspace/loader changes
  }, [loadDirectory, workspace])

  useEffect(() => {
    setDraft(null)
    setContextMenuOpen(false)
  }, [mode])

  useEffect(() => {
    nameInputRef.current?.focus()
    nameInputRef.current?.select()
    inputRowRef.current?.scrollIntoView({ block: 'nearest' })
  }, [draft?.parentPath, draft?.type])

  useEffect(() => {
    if (!draft || creating) return
    const cancelOnOutsideClick = (event: PointerEvent): void => {
      if (event.target instanceof Node && !inputRowRef.current?.contains(event.target))
        setDraft(null)
    }
    document.addEventListener('pointerdown', cancelOnOutsideClick, true)
    return () => document.removeEventListener('pointerdown', cancelOnOutsideClick, true)
  }, [draft, creating])

  useEffect(() => {
    if (highlightedPath) highlightedFileRef.current?.scrollIntoView({ block: 'nearest' })
  }, [childrenByPath, highlightedPath])

  useEffect(() => {
    if (!highlightedPath) return
    const timer = window.setTimeout(() => setHighlightedPath(null), 2500)
    return () => window.clearTimeout(timer)
  }, [highlightedPath])

  const beginCreate = (type: NewFileType): void => {
    const parentPath =
      contextTarget?.kind === 'directory'
        ? contextTarget.relative_path
        : getParentPath(contextTarget?.relative_path || '')
    setQuery('')
    if (parentPath) setExpanded((current) => new Set(current).add(parentPath))
    void loadDirectory(parentPath)
    setDraft({
      parentPath,
      type,
      name: newFileTypes.find((item) => item.type === type)?.name || '新建文件',
      extension: type === 'other' ? '' : type,
      error: null
    })
  }

  const createFile = async (): Promise<void> => {
    if (!workspace || !draft || mutationInFlightRef.current) return
    const extension = draft.extension.trim().replace(/^\./, '')
    if (!draft.name.trim()) {
      setDraft({ ...draft, error: '请输入文件名' })
      return
    }
    if (!/^[\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)*$/u.test(extension)) {
      setDraft({ ...draft, error: '请输入有效后缀，例如 txt 或 md' })
      return
    }
    mutationInFlightRef.current = true
    setCreating(true)
    try {
      const response = await window.api.workspaceFileCreate({
        workspaceId: workspace.id,
        parentRelativePath: draft.parentPath,
        fileName: `${draft.name.trim()}.${extension}`
      })
      if (!response.success || !response.entry) throw new Error(response.error || '新建文件失败')
      if (workspaceIdRef.current !== workspace.id) return
      setDraft(null)
      await loadDirectory(draft.parentPath)
      if (workspaceIdRef.current !== workspace.id) return
      setHighlightedPath(response.entry.relative_path)
      onFileChanged(response.entry.absolute_path)
    } catch (error) {
      if (workspaceIdRef.current === workspace.id) {
        setDraft({ ...draft, error: error instanceof Error ? error.message : '新建文件失败' })
      }
    } finally {
      mutationInFlightRef.current = false
      setCreating(false)
    }
  }

  const trashFile = async (): Promise<void> => {
    if (!workspace || !deleteTarget || mutationInFlightRef.current) return
    mutationInFlightRef.current = true
    setDeleting(true)
    try {
      await withTextFileDeletion(deleteTarget.absolute_path, async () => {
        const response = await window.api.workspaceFileTrash({
          workspaceId: workspace.id,
          relativePath: deleteTarget.relative_path
        })
        if (!response.success) throw new Error(response.error || '移到回收站失败')
      })
      onFileChanged(deleteTarget.absolute_path)
      if (workspaceIdRef.current !== workspace.id) return
      setDeleteTarget(null)
      await loadDirectory(getParentPath(deleteTarget.relative_path))
      void message.success('文件已移到回收站')
    } catch (error) {
      void message.error(error instanceof Error ? error.message : '移到回收站失败')
    } finally {
      mutationInFlightRef.current = false
      setDeleting(false)
    }
  }

  const contextMenu: MenuProps = {
    items: [
      {
        key: 'create',
        label: '新建文件',
        children: newFileTypes.map(({ type, label }) => ({ key: type, label }))
      },
      ...(contextTarget?.kind === 'file' ? [{ key: 'delete', label: '删除', danger: true }] : [])
    ],
    onClick: ({ key }) => {
      setContextMenuOpen(false)
      if (key === 'delete') setDeleteTarget(contextTarget)
      else if (newFileTypes.some((item) => item.type === key)) beginCreate(key as NewFileType)
    }
  }

  const renderDraft = (parentPath: string, depth: number): React.ReactNode =>
    draft?.parentPath === parentPath ? (
      <div ref={inputRowRef} className="py-1 pr-2" style={{ paddingLeft: 30 + depth * 14 }}>
        <div className="flex min-h-7 items-center gap-1 rounded-[6px] border border-[#0B6BCB] bg-white px-1.5 text-[13px]">
          <HiDocumentText className="h-4 w-4 shrink-0 text-[#91918E]" />
          <input
            ref={nameInputRef}
            aria-label="新建文件名"
            value={draft.name}
            disabled={creating}
            className="min-w-0 flex-1 bg-transparent text-[#37352F] outline-none"
            onChange={(event) => setDraft({ ...draft, name: event.target.value, error: null })}
            onKeyDown={handleDraftKeyDown}
          />
          <span className="text-[#787774]">.</span>
          {draft.type === 'other' ? (
            <input
              aria-label="文件后缀"
              placeholder="后缀"
              value={draft.extension}
              disabled={creating}
              className="w-14 min-w-0 bg-transparent text-[#37352F] outline-none"
              onChange={(event) =>
                setDraft({ ...draft, extension: event.target.value, error: null })
              }
              onKeyDown={handleDraftKeyDown}
            />
          ) : (
            <span className="text-[#787774]">{draft.extension}</span>
          )}
        </div>
        {draft.error ? (
          <div role="alert" className="mt-1 text-xs text-[#B3261E]">
            {draft.error}
          </div>
        ) : null}
      </div>
    ) : null

  function handleDraftKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (!creating) setDraft(null)
    } else if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) {
      event.preventDefault()
      void createFile()
    }
  }

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
    return (
      <>
        {renderDraft(parentPath, depth)}
        {entries.map((entry) => {
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
                    : highlightedPath === entry.relative_path
                      ? 'bg-[#EDF3F8] text-[#2F5F8F]'
                      : 'text-[#57554F] hover:bg-[#F4F4F2]'
                } ${visible ? '' : 'hidden'}`}
                style={{ paddingLeft: 8 + depth * 14 }}
                title={entry.relative_path}
                aria-current={selected ? 'page' : undefined}
                data-workspace-entry="true"
                ref={highlightedPath === entry.relative_path ? highlightedFileRef : undefined}
                onContextMenu={() => setContextTarget(entry)}
                onKeyDown={(event) => {
                  if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                    event.preventDefault()
                    setContextTarget(entry)
                    setContextMenuOpen(true)
                  }
                }}
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
        })}
      </>
    )
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
      <Dropdown
        trigger={['contextMenu']}
        menu={contextMenu}
        disabled={mode !== 'all' || creating || deleting}
        open={contextMenuOpen && mode === 'all'}
        onOpenChange={setContextMenuOpen}
        dropdownRender={(menu) => (
          <div
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                setContextMenuOpen(false)
              }
            }}
          >
            {menu}
          </div>
        )}
      >
        <div
          className="min-h-0 flex-1 overflow-auto pb-2"
          data-testid={workbenchSelectors.workspaceExplorerList}
          onContextMenu={(event) => {
            if (
              !(event.target instanceof Element) ||
              !event.target.closest('[data-workspace-entry]')
            ) {
              setContextTarget(null)
            }
          }}
        >
          {mode === 'all' ? (
            !childrenByPath[''] && !draft ? (
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
            ) : childrenByPath['']?.length === 0 && !draft ? (
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
      </Dropdown>
      <Modal
        open={Boolean(deleteTarget)}
        title="删除文件？"
        okText="移到回收站"
        cancelText="取消"
        okButtonProps={{ danger: true }}
        confirmLoading={deleting}
        cancelButtonProps={{ disabled: deleting }}
        closable={!deleting}
        maskClosable={!deleting}
        keyboard={!deleting}
        onCancel={() => setDeleteTarget(null)}
        onOk={() => void trashFile()}
      >
        <p className="break-all">将「{deleteTarget?.name}」移到系统回收站，可在回收站中恢复。</p>
      </Modal>
    </div>
  )
}

export default WorkspaceFileExplorer
