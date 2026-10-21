import { t, getRendererRuntime } from '../../i18n'
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { App, Dropdown, Modal, type MenuProps } from 'antd'
import { HiChevronDown, HiChevronRight, HiOutlineMagnifyingGlass } from 'react-icons/hi2'
import type {
  AiFileChangeRecord,
  WorkspaceSource,
  WorkspaceTreeEntry
} from '../../../../shared/types'
import { filterVisibleFileChangeRecords } from '../../../../shared/fileChangeVisibility'
import { LuFilePlus2, LuPencil, LuTrash2 } from 'react-icons/lu'
import FileIcon from '../FileIcon'
import FileNameInput from './FileNameInput'
import ChangeCountBadges from './ChangeCountBadges'
import WorkspaceFilesEmptyState from './WorkspaceFilesEmptyState'
import type { WorkspaceLoadState } from './types'
import { workbenchSelectors } from '../../testing/selectors'
import { withTextFileMutation } from '../fileRenders/pendingTextSaves'
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
  onModeChange: (mode: WorkspaceFileExplorerMode) => void
  onOpenFile: (entry: WorkspaceTreeEntry) => void
  onOpenChange: (change: AiFileChangeRecord) => void
  onFileChanged: (filePath: string) => void
  onFileRenamed: (oldPath: string, entry: WorkspaceTreeEntry) => void
}

type NewFileType = 'docx' | 'xlsx' | 'pptx' | 'other'
type FileNameDraft = {
  parentPath: string
  name: string
  suffix: string
  error: string | null
} & ({ kind: 'create' } | { kind: 'rename'; entry: WorkspaceTreeEntry })

const getParentPath = (relativePath: string): string =>
  relativePath.split('/').slice(0, -1).join('/')

const newFileTypes: { type: NewFileType; label: string; name: string }[] = [
  { type: 'docx', label: 'Word', name: t(($) => $.workbench.newDocument) },
  { type: 'xlsx', label: 'Excel', name: t(($) => $.workbench.newWorkbook) },
  { type: 'pptx', label: 'PPT', name: t(($) => $.workbench.newPresentation) },
  { type: 'other', label: t(($) => $.workbench.otherFiles), name: t(($) => $.workbench.newFile) }
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
  onModeChange,
  onOpenFile,
  onOpenChange,
  onFileChanged,
  onFileRenamed
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
  const [draft, setDraft] = useState<FileNameDraft | null>(null)
  const [savingFile, setSavingFile] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceTreeEntry | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const inputRowRef = useRef<HTMLDivElement | null>(null)
  const explorerRef = useRef<HTMLDivElement | null>(null)
  const selectedFileRef = useRef<HTMLButtonElement | null>(null)
  const mutationInFlightRef = useRef(false)
  const workspaceIdRef = useRef(workspace?.id)
  const directoryRequestIds = useRef<Record<string, number>>({})
  const expandedRef = useRef(expanded)
  const appliedReloadTokenRef = useRef(reloadToken)
  useLayoutEffect(() => {
    workspaceIdRef.current = workspace?.id
    expandedRef.current = expanded
  }, [workspace?.id, expanded])

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
    setSelectedKey(null)
    if (workspace) void loadDirectory('')
    // reloadToken 只在工作区切换时同步，避免每次刷新都清空展开态
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when workspace/loader changes
  }, [loadDirectory, workspace])

  useEffect(() => {
    setDraft(null)
    setContextMenuOpen(false)
  }, [mode])

  useEffect(() => {
    const onOutsideClick = (event: PointerEvent): void => {
      if (!(event.target instanceof Element)) return
      if (draft && !savingFile && !inputRowRef.current?.contains(event.target)) setDraft(null)
      if (
        !event.target.closest('.workspace-file-menu') &&
        !(
          explorerRef.current?.contains(event.target) &&
          event.target.closest('[data-workspace-entry]')
        ) &&
        !inputRowRef.current?.contains(event.target)
      )
        setSelectedKey(null)
    }
    document.addEventListener('pointerdown', onOutsideClick, true)
    return () => document.removeEventListener('pointerdown', onOutsideClick, true)
  }, [draft, savingFile])

  useEffect(() => {
    if (selectedKey) selectedFileRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selectedKey])

  const beginCreate = (type: NewFileType): void => {
    const parentPath =
      contextTarget?.kind === 'directory'
        ? contextTarget.relative_path
        : getParentPath(contextTarget?.relative_path || '')
    const suffix = type === 'other' ? '' : `.${type}`
    setQuery('')
    if (parentPath) setExpanded((current) => new Set(current).add(parentPath))
    void loadDirectory(parentPath)
    setDraft({
      kind: 'create',
      parentPath,
      suffix,
      name: `${newFileTypes.find((item) => item.type === type)?.name || t(($) => $.workbench.newFile)}${suffix}`,
      error: null
    })
  }

  const beginRename = (entry: WorkspaceTreeEntry): void => {
    const dot = entry.name.lastIndexOf('.')
    setDraft({
      kind: 'rename',
      entry,
      parentPath: getParentPath(entry.relative_path),
      name: entry.name,
      suffix: dot > 0 ? entry.name.slice(dot) : '',
      error: null
    })
  }

  const submitFileName = async (): Promise<void> => {
    if (!workspace || !draft || mutationInFlightRef.current) return
    const fileName = draft.name.trim()
    const baseName = draft.suffix ? fileName.slice(0, -draft.suffix.length) : fileName
    const dot = fileName.lastIndexOf('.')
    if (!baseName.trim()) {
      setDraft({ ...draft, error: t(($) => $.workbench.enterAFileName) })
      return
    }
    if (
      draft.kind === 'create' &&
      !draft.suffix &&
      (dot <= 0 || !/^[\p{L}\p{N}_-]+$/u.test(fileName.slice(dot + 1)))
    ) {
      setDraft({ ...draft, error: t(($) => $.workbench.enterAFileNameWithAValidExtensionSuch) })
      return
    }
    if (draft.kind === 'rename' && fileName === draft.entry.name) {
      setDraft(null)
      return
    }
    mutationInFlightRef.current = true
    setSavingFile(true)
    try {
      let entry: WorkspaceTreeEntry
      if (draft.kind === 'rename') {
        entry = await withTextFileMutation(draft.entry.absolute_path, 'renamed', async () => {
          const response = await window.api.workspaceFileRename({
            workspaceId: workspace.id,
            relativePath: draft.entry.relative_path,
            fileName
          })
          if (!response.success || !response.entry)
            throw new Error(response.error || t(($) => $.workbench.couldNotRename))
          return response.entry
        })
        onFileRenamed(draft.entry.absolute_path, entry)
      } else {
        const response = await window.api.workspaceFileCreate({
          workspaceId: workspace.id,
          parentRelativePath: draft.parentPath,
          fileName
        })
        if (!response.success || !response.entry)
          throw new Error(response.error || t(($) => $.workbench.couldNotCreateTheFile))
        entry = response.entry
        onFileChanged(entry.absolute_path)
      }
      if (workspaceIdRef.current !== workspace.id) return
      setDraft(null)
      setQuery('')
      await loadDirectory(draft.parentPath)
      if (workspaceIdRef.current !== workspace.id) return
      setSelectedKey(`file:${normalizePath(entry.absolute_path)}`)
    } catch (error) {
      if (workspaceIdRef.current === workspace.id)
        setDraft({
          ...draft,
          error: error instanceof Error ? error.message : t(($) => $.workbench.fileOperationFailed)
        })
    } finally {
      mutationInFlightRef.current = false
      setSavingFile(false)
    }
  }

  const trashFile = async (): Promise<void> => {
    if (!workspace || !deleteTarget || mutationInFlightRef.current) return
    mutationInFlightRef.current = true
    setDeleting(true)
    try {
      await withTextFileMutation(deleteTarget.absolute_path, 'deleted', async () => {
        const response = await window.api.workspaceFileTrash({
          workspaceId: workspace.id,
          relativePath: deleteTarget.relative_path
        })
        if (!response.success)
          throw new Error(response.error || t(($) => $.workbench.couldNotMoveToTrash))
      })
      onFileChanged(deleteTarget.absolute_path)
      if (workspaceIdRef.current !== workspace.id) return
      setDeleteTarget(null)
      setSelectedKey(null)
      await loadDirectory(getParentPath(deleteTarget.relative_path))
      void message.success(t(($) => $.workbench.fileMovedToTrash))
    } catch (error) {
      void message.error(
        error instanceof Error ? error.message : t(($) => $.workbench.couldNotMoveToTrash)
      )
    } finally {
      mutationInFlightRef.current = false
      setDeleting(false)
    }
  }

  const contextMenu: MenuProps = {
    selectable: false,
    items: [
      {
        key: 'create',
        label: t(($) => $.workbench.newFile),
        icon: <LuFilePlus2 aria-hidden className="h-4 w-4" />,
        popupClassName: 'workspace-file-menu',
        children: newFileTypes.map(({ type, label }) => ({
          key: type,
          label,
          icon: (
            <FileIcon
              extension={type === 'other' ? '' : type}
              className="h-4 w-4 shrink-0 text-[#787774]"
            />
          )
        }))
      },
      ...(contextTarget?.kind === 'file'
        ? [
            { type: 'divider' as const },
            {
              key: 'rename',
              label: t(($) => $.workbench.rename),
              icon: <LuPencil aria-hidden className="h-4 w-4" />
            },
            {
              key: 'delete',
              label: t(($) => $.common.delete),
              danger: true,
              icon: <LuTrash2 aria-hidden className="h-4 w-4" />
            }
          ]
        : [])
    ],
    onClick: ({ key }) => {
      setContextMenuOpen(false)
      if (key === 'delete') setDeleteTarget(contextTarget)
      else if (key === 'rename' && contextTarget) beginRename(contextTarget)
      else if (newFileTypes.some((item) => item.type === key)) beginCreate(key as NewFileType)
    }
  }

  const renderDraft = (parentPath: string, depth: number): React.ReactNode =>
    draft?.parentPath === parentPath ? (
      <div ref={inputRowRef} className="py-1 pr-2" style={{ paddingLeft: 25 + depth * 18 }}>
        <FileNameInput
          key={draft.kind === 'rename' ? draft.entry.id : `create:${parentPath}:${draft.suffix}`}
          value={draft.name}
          suffix={draft.suffix}
          renaming={draft.kind === 'rename'}
          busy={savingFile}
          error={draft.error}
          onChange={(name) => setDraft({ ...draft, name, error: null })}
          onSubmit={() => void submitFileName()}
          onCancel={() => setDraft(null)}
        />
      </div>
    ) : null

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
    const entries = [...(childrenByPath[parentPath] || [])].sort((a, b) =>
      a.kind === b.kind ? 0 : a.kind === 'directory' ? -1 : 1
    )
    const firstFileIndex = entries.findIndex((entry) => entry.kind === 'file')
    const normalizedQuery = query.trim().toLowerCase()
    return (
      <>
        {draft?.kind === 'create' && firstFileIndex === -1 && entries.length === 0
          ? renderDraft(parentPath, depth)
          : null}
        {entries.map((entry, index) => {
          const isDirectory = entry.kind === 'directory'
          const isExpanded = expanded.has(entry.relative_path)
          const change = changesByPath.get(normalizePath(entry.absolute_path))
          const visible =
            !normalizedQuery || entry.relative_path.toLowerCase().includes(normalizedQuery)
          const entryKey = `file:${normalizePath(entry.absolute_path)}`
          const selected = selectedKey === entryKey
          return (
            <React.Fragment key={entry.id}>
              {draft?.kind === 'create' && index === firstFileIndex
                ? renderDraft(parentPath, depth)
                : null}
              {draft?.kind === 'rename' && draft.entry.id === entry.id ? (
                renderDraft(parentPath, depth)
              ) : (
                <button
                  type="button"
                  className={`relative flex h-[30px] w-full items-center gap-1.5 pr-2 text-left text-[13px] transition-colors ${
                    selected ? 'bg-[#EEEEEB] text-[#37352F]' : 'text-[#57554F]'
                  } ${visible ? '' : 'hidden'}`}
                  style={{ paddingLeft: 8 + depth * 18 }}
                  title={entry.relative_path}
                  aria-current={selected ? 'true' : undefined}
                  data-workspace-entry="true"
                  ref={selected ? selectedFileRef : undefined}
                  onContextMenu={() => {
                    setContextTarget(entry)
                    setSelectedKey(entryKey)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                      event.preventDefault()
                      setContextTarget(entry)
                      setSelectedKey(entryKey)
                      setContextMenuOpen(true)
                    }
                  }}
                  onClick={() => {
                    setSelectedKey(entryKey)
                    isDirectory ? toggleDirectory(entry) : onOpenFile(entry)
                  }}
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
                  <FileIcon
                    name={entry.name}
                    extension={entry.file_ext}
                    kind={isDirectory ? 'directory' : undefined}
                    expanded={isExpanded}
                  />
                  <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                  {change ? (
                    <span title={t(($) => $.workbench.modifiedInTheCurrentRun)}>
                      {change.insertCount > 0 || change.deleteCount > 0 ? (
                        <ChangeCountBadges
                          insertCount={change.insertCount}
                          deleteCount={change.deleteCount}
                          mode="compact"
                        />
                      ) : (
                        <span className="text-[11px] font-medium text-[#787774]">
                          {t(($) => $.workbench.changed)}
                        </span>
                      )}
                    </span>
                  ) : null}
                </button>
              )}
              {isDirectory && isExpanded ? renderEntries(entry.relative_path, depth + 1) : null}
            </React.Fragment>
          )
        })}
        {draft?.kind === 'create' && firstFileIndex === -1 && entries.length > 0
          ? renderDraft(parentPath, depth)
          : null}
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
    <div
      ref={explorerRef}
      className="flex h-full min-h-0 flex-col border-l border-[#EEEEEC] bg-white"
    >
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
            {t(($) => $.common.all)}
          </button>
          <button
            type="button"
            className={`rounded-[5px] text-[12px] font-medium ${mode === 'changed' ? 'bg-white text-[#37352F] shadow-sm' : 'text-[#787774] hover:text-[#37352F]'}`}
            onClick={() => onModeChange('changed')}
          >
            {t(($) => $.workbench.changesInThisRun)}
            {activeChanges.length}
          </button>
        </div>
      </div>
      <div className="shrink-0 p-2">
        <label className="flex h-8 items-center gap-2 rounded-[6px] border border-[#E0DFDC] px-2.5 text-[#91918E]">
          <HiOutlineMagnifyingGlass className="h-4 w-4 shrink-0" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t(($) => $.workbench.filterFiles)}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-[#37352F] outline-none placeholder:text-[#9B9A97]"
          />
        </label>
      </div>
      <Dropdown
        trigger={['contextMenu']}
        destroyPopupOnHide
        overlayClassName="workspace-file-menu"
        menu={contextMenu}
        disabled={mode !== 'all' || savingFile || deleting}
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
              setSelectedKey(null)
            }
          }}
        >
          {mode === 'all' ? (
            !childrenByPath[''] && !draft ? (
              directoryErrors.has('') && !loading.has('') ? (
                <div className="px-3 py-2 text-xs text-[#91918E]">
                  {t(($) => $.workbench.couldNotReadTheDirectory)}
                  <button
                    type="button"
                    className="ml-2 text-[#37352F] underline"
                    onClick={() => void loadDirectory('')}
                  >
                    {t(($) => $.common.retry)}
                  </button>
                </div>
              ) : (
                <div role="status" className="px-3 py-2 text-xs text-[#91918E]">
                  {t(($) => $.workbench.loadingFiles)}
                </div>
              )
            ) : childrenByPath['']?.length === 0 && !draft ? (
              <div className="px-3 py-2 text-xs text-[#91918E]">
                {t(($) => $.workbench.thisDirectoryHasNoFiles)}
              </div>
            ) : (
              renderEntries('', 0)
            )
          ) : filteredChanges.length > 0 ? (
            filteredChanges.map(({ latest, records }) => {
              const selected = selectedKey === `change:${latest.id}`
              const isExpanded = expandedChangeGroups.has(latest.id)
              const displayPath = getRelativePath(
                workspace,
                latest.afterPath || latest.beforePath || latest.path
              )
              return (
                <React.Fragment key={latest.id}>
                  <button
                    type="button"
                    className={`relative flex h-9 w-full items-center gap-2 px-2 text-left text-[13px] transition-colors ${selected ? 'bg-[#EEEEEB] text-[#37352F]' : 'text-[#57554F]'}`}
                    aria-current={selected ? 'true' : undefined}
                    data-workspace-entry="true"
                    data-testid={`${workbenchSelectors.workspaceFileChangePrefix}-${latest.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`}
                    onClick={() => {
                      setSelectedKey(`change:${latest.id}`)
                      onOpenChange(latest)
                    }}
                  >
                    {records.length > 1 ? (
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label={
                          isExpanded
                            ? t(($) => $.workbench.collapseChangeHistory)
                            : t(($) => $.workbench.expandChangeHistory)
                        }
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
                    <FileIcon name={displayPath} />
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
                          ? t(($) => $.common.deleted)
                          : latest.operation === 'renamed'
                            ? t(($) => $.workbench.renamed)
                            : t(($) => $.workbench.changed)}
                      </span>
                    )}
                    {records.length > 1 ? (
                      <span className="shrink-0 text-[11px] tabular-nums text-[#9B9A97]">
                        {records.length}
                        {t(($) => $.workbench.times)}
                      </span>
                    ) : null}
                  </button>
                  {records.length > 1 && isExpanded ? (
                    <div className="border-b border-[#EEEEEC] bg-[#FAFAF9] py-1">
                      {records.map((record, index) => (
                        <button
                          data-workspace-entry="true"
                          key={record.id}
                          type="button"
                          className={`flex h-8 w-full items-center gap-2 pl-9 pr-2 text-left text-[12px] ${selectedKey === `change:${record.id}` ? 'bg-[#EEEEEB] text-[#37352F]' : 'text-[#787774]'}`}
                          aria-current={selectedKey === `change:${record.id}` ? 'page' : undefined}
                          onClick={() => {
                            setSelectedKey(`change:${record.id}`)
                            onOpenChange(record)
                          }}
                        >
                          <span className="shrink-0">
                            {index === 0
                              ? t(($) => $.workbench.latest)
                              : t(($) => $.workbench.change, { value1: records.length - index })}
                          </span>
                          <span className="min-w-0 flex-1 truncate">
                            {record.runSummary || t(($) => $.workbench.fileChanges)}
                          </span>
                          <span className="shrink-0 tabular-nums text-[#9B9A97]">
                            {new Date(record.updatedAt).toLocaleTimeString(
                              getRendererRuntime().locale,
                              {
                                hour: '2-digit',
                                minute: '2-digit'
                              }
                            )}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </React.Fragment>
              )
            })
          ) : (
            <div className="px-3 py-8 text-center text-xs text-[#91918E]">
              {t(($) => $.workbench.noFileChangesInThisRun)}
            </div>
          )}
        </div>
      </Dropdown>
      <Modal
        open={Boolean(deleteTarget)}
        title={t(($) => $.workbench.deleteFile)}
        okText={t(($) => $.workbench.moveToTrash)}
        cancelText={t(($) => $.common.cancel)}
        okButtonProps={{ danger: true }}
        confirmLoading={deleting}
        cancelButtonProps={{ disabled: deleting }}
        closable={!deleting}
        maskClosable={!deleting}
        keyboard={!deleting}
        onCancel={() => setDeleteTarget(null)}
        onOk={() => void trashFile()}
      >
        <p className="break-all">
          {t(($) => $.workbench.move)}
          {deleteTarget?.name}
          {t(($) => $.workbench.toTheSystemTrashYouCanRestoreItFrom)}
        </p>
      </Modal>
    </div>
  )
}

export default WorkspaceFileExplorer
