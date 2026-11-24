import { t, getRendererRuntime } from '../../i18n'
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { App, Dropdown, Modal, type MenuProps } from 'antd'
import { HiChevronDown, HiChevronRight, HiOutlineMagnifyingGlass } from 'react-icons/hi2'
import type {
  AiFileChangeRecord,
  WorkspaceListItem,
  WorkspaceSource,
  WorkspaceTreeEntry
} from '../../../../shared/types'
import { filterVisibleFileChangeRecords } from '../../../../shared/fileChangeVisibility'
import { LuFilePlus2, LuPencil, LuTrash2 } from 'react-icons/lu'
import FileIcon from '../FileIcon'
import { getVisibleExpandedPaths, useWorkspaceTreeExpansion } from '../useWorkspaceTreeExpansion'
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
  workspaces: WorkspaceListItem[]
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
  workspaceId: string
  parentPath: string
  name: string
  suffix: string
  error: string | null
} & ({ kind: 'create' } | { kind: 'rename'; entry: WorkspaceTreeEntry })

const getDirectoryKey = (workspaceId: string, relativePath: string): string =>
  `${workspaceId}:${relativePath}`

let directorySnapshot: Record<string, WorkspaceTreeEntry[]> = {}

const getParentPath = (relativePath: string): string =>
  relativePath.split('/').slice(0, -1).join('/')

const newFileTypes: { type: NewFileType; label: string; name: string }[] = [
  { type: 'docx', label: 'Word', name: t(($) => $.workbench.newDocument) },
  { type: 'xlsx', label: 'Excel', name: t(($) => $.workbench.newWorkbook) },
  { type: 'pptx', label: 'PPT', name: t(($) => $.workbench.newPresentation) },
  { type: 'other', label: t(($) => $.workbench.otherFiles), name: t(($) => $.workbench.newFile) }
]

const getRelativePath = (workspaces: WorkspaceSource[], filePath: string): string => {
  const workspace = workspaces.find((item) =>
    normalizePath(filePath).startsWith(`${normalizePath(item.root_path)}/`)
  )
  const root = normalizePath(workspace?.root_path || '')
  const normalized = filePath.replace(/\\/g, '/')
  return root && normalizePath(normalized).startsWith(`${root}/`)
    ? normalized.slice(
        (workspace?.root_path || '').replace(/\\/g, '/').replace(/\/+$/g, '').length + 1
      )
    : normalized
}

const WorkspaceFileExplorer: React.FC<WorkspaceFileExplorerProps> = ({
  workspaces,
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
  const [childrenByPath, setChildrenByPath] = useState(() => directorySnapshot)
  const { expandedDirectories, setDirectoryExpanded } = useWorkspaceTreeExpansion('workbench')
  const [restoringTree, setRestoringTree] = useState(() =>
    workspaces.some((workspace) =>
      getVisibleExpandedPaths(expandedDirectories[workspace.id] || []).some(
        (path) => !directorySnapshot[getDirectoryKey(workspace.id, path)]
      )
    )
  )
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
  const workspacesRef = useRef(workspaces)
  const directoryRequestIds = useRef<Record<string, number>>({})
  const expandedRef = useRef(expandedDirectories)
  const appliedReloadTokenRef = useRef(reloadToken)
  useLayoutEffect(() => {
    workspacesRef.current = workspaces
    expandedRef.current = expandedDirectories
  }, [workspaces, expandedDirectories])

  useEffect(() => {
    directorySnapshot = childrenByPath
  }, [childrenByPath])

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
    async (workspaceId: string, relativePath: string): Promise<void> => {
      const workspace = workspacesRef.current.find((item) => item.id === workspaceId)
      if (!workspace || workspace.root_kind === 'file') return
      const key = getDirectoryKey(workspaceId, relativePath)
      const requestId = (directoryRequestIds.current[key] || 0) + 1
      directoryRequestIds.current[key] = requestId
      const isLatestRequest = (): boolean =>
        directoryRequestIds.current[key] === requestId &&
        workspacesRef.current.some(
          (item) => item.id === workspaceId && item.root_path === workspace.root_path
        )
      setLoading((current) => new Set(current).add(key))
      try {
        const response = await window.api.workspaceDirectoryList({
          workspaceId,
          relativePath,
          purpose: 'browse'
        })
        if (!isLatestRequest()) return
        if (response.error) throw new Error(response.error)
        setChildrenByPath((current) => ({ ...current, [key]: response.items }))
        setDirectoryErrors((current) => {
          const next = new Set(current)
          next.delete(key)
          return next
        })
      } catch {
        if (isLatestRequest()) setDirectoryErrors((current) => new Set(current).add(key))
      } finally {
        if (isLatestRequest()) {
          setLoading((current) => {
            const next = new Set(current)
            next.delete(key)
            return next
          })
        }
      }
    },
    []
  )

  const refreshVisibleDirectories = useCallback(async (): Promise<void> => {
    await Promise.all(
      workspacesRef.current.flatMap((workspace) =>
        getVisibleExpandedPaths(expandedRef.current[workspace.id] || []).map((path) =>
          loadDirectory(workspace.id, path)
        )
      )
    )
  }, [loadDirectory])

  useEffect(() => {
    void refreshVisibleDirectories()
  }, [refreshVisibleDirectories, workspaces])

  useEffect(() => {
    if (!restoringTree) return
    const pending = workspaces.some((workspace) =>
      getVisibleExpandedPaths(expandedDirectories[workspace.id] || []).some((path) => {
        const key = getDirectoryKey(workspace.id, path)
        return !childrenByPath[key] && !directoryErrors.has(key)
      })
    )
    if (!pending) setRestoringTree(false)
  }, [restoringTree, workspaces, expandedDirectories, childrenByPath, directoryErrors])

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

  const createWorkspaceId =
    contextTarget?.workspace_id ||
    (workspaces.length === 1 && workspaces[0].root_kind !== 'file' ? workspaces[0].id : undefined)

  const beginCreate = (type: NewFileType): void => {
    if (!createWorkspaceId) return
    const workspaceId = createWorkspaceId
    const parentPath =
      contextTarget?.kind === 'directory'
        ? contextTarget.relative_path
        : getParentPath(contextTarget?.relative_path || '')
    const suffix = type === 'other' ? '' : `.${type}`
    setQuery('')
    setDirectoryExpanded(workspaceId, '', true)
    if (parentPath) {
      setDirectoryExpanded(workspaceId, parentPath, true)
    }
    void loadDirectory(workspaceId, parentPath)
    setDraft({
      kind: 'create',
      workspaceId,
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
      workspaceId: entry.workspace_id,
      entry,
      parentPath: getParentPath(entry.relative_path),
      name: entry.name,
      suffix: dot > 0 ? entry.name.slice(dot) : '',
      error: null
    })
  }

  const submitFileName = async (): Promise<void> => {
    if (!draft || mutationInFlightRef.current) return
    const workspaceId = draft.workspaceId
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
            workspaceId,
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
          workspaceId,
          parentRelativePath: draft.parentPath,
          fileName
        })
        if (!response.success || !response.entry)
          throw new Error(response.error || t(($) => $.workbench.couldNotCreateTheFile))
        entry = response.entry
        onFileChanged(entry.absolute_path)
      }
      if (!workspacesRef.current.some((item) => item.id === workspaceId)) return
      setDraft(null)
      setQuery('')
      await loadDirectory(workspaceId, draft.parentPath)
      if (!workspacesRef.current.some((item) => item.id === workspaceId)) return
      setSelectedKey(`file:${normalizePath(entry.absolute_path)}`)
    } catch (error) {
      if (workspacesRef.current.some((item) => item.id === workspaceId))
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
    if (!deleteTarget || mutationInFlightRef.current) return
    const workspaceId = deleteTarget.workspace_id
    mutationInFlightRef.current = true
    setDeleting(true)
    try {
      await withTextFileMutation(deleteTarget.absolute_path, 'deleted', async () => {
        const response = await window.api.workspaceFileTrash({
          workspaceId,
          relativePath: deleteTarget.relative_path
        })
        if (!response.success)
          throw new Error(response.error || t(($) => $.workbench.couldNotMoveToTrash))
      })
      onFileChanged(deleteTarget.absolute_path)
      if (!workspacesRef.current.some((item) => item.id === workspaceId)) return
      setDeleteTarget(null)
      setSelectedKey(null)
      await loadDirectory(workspaceId, getParentPath(deleteTarget.relative_path))
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
        disabled:
          !createWorkspaceId ||
          Boolean(contextTarget?.kind === 'file' && !contextTarget.relative_path),
        label: t(($) => $.workbench.newFile),
        icon: <LuFilePlus2 aria-hidden className="h-4 w-4" />,
        popupClassName: 'workspace-file-menu',
        children: newFileTypes.map(({ type, label }) => ({
          key: type,
          label,
          icon: (
            <FileIcon
              extension={type === 'other' ? '' : type}
              className="h-4 w-4 shrink-0 text-[var(--notion-text-soft)]"
            />
          )
        }))
      },
      ...(contextTarget?.kind === 'file' && contextTarget.relative_path
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

  const renderDraft = (workspaceId: string, parentPath: string, depth: number): React.ReactNode =>
    draft?.workspaceId === workspaceId && draft.parentPath === parentPath ? (
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
    if (reloadToken === appliedReloadTokenRef.current) return
    appliedReloadTokenRef.current = reloadToken
    void refreshVisibleDirectories()
  }, [reloadToken, refreshVisibleDirectories])

  useEffect(() => {
    if (!liveRefreshEnabled) return
    const refreshOnFocus = (): void => {
      void refreshVisibleDirectories()
    }
    const refreshOnVisibility = (): void => {
      if (!document.hidden) void refreshVisibleDirectories()
    }
    window.addEventListener('focus', refreshOnFocus)
    document.addEventListener('visibilitychange', refreshOnVisibility)
    return () => {
      window.removeEventListener('focus', refreshOnFocus)
      document.removeEventListener('visibilitychange', refreshOnVisibility)
    }
  }, [liveRefreshEnabled, refreshVisibleDirectories])

  const toggleDirectory = (entry: WorkspaceTreeEntry): void => {
    const { workspace_id: workspaceId, relative_path: relativePath } = entry
    const paths = expandedDirectories[workspaceId] || []
    const opening = !paths.includes(relativePath)
    setDirectoryExpanded(workspaceId, relativePath, opening)
    if (opening) {
      for (const path of getVisibleExpandedPaths([...paths, relativePath])) {
        if (!relativePath || path === relativePath || path.startsWith(`${relativePath}/`)) {
          void loadDirectory(workspaceId, path)
        }
      }
    }
  }

  const renderEntries = (
    workspaceId: string,
    parentPath: string,
    depth: number
  ): React.ReactNode => {
    const entries = childrenByPath[getDirectoryKey(workspaceId, parentPath)] || []
    const firstFileIndex = entries.findIndex((entry) => entry.kind === 'file')
    const normalizedQuery = query.trim().toLowerCase()
    return (
      <>
        {draft?.kind === 'create' && firstFileIndex === -1 && entries.length === 0
          ? renderDraft(workspaceId, parentPath, depth)
          : null}
        {entries.map((entry, index) => {
          const isDirectory = entry.kind === 'directory'
          const isExpanded =
            expandedDirectories[workspaceId]?.includes(entry.relative_path) === true
          const change = changesByPath.get(normalizePath(entry.absolute_path))
          const visible =
            !normalizedQuery || entry.relative_path.toLowerCase().includes(normalizedQuery)
          const entryKey = `file:${normalizePath(entry.absolute_path)}`
          const selected = selectedKey === entryKey
          return (
            <React.Fragment key={entry.id}>
              {draft?.kind === 'create' && index === firstFileIndex
                ? renderDraft(workspaceId, parentPath, depth)
                : null}
              {draft?.kind === 'rename' && draft.entry.id === entry.id ? (
                renderDraft(workspaceId, parentPath, depth)
              ) : (
                <button
                  type="button"
                  className={`relative flex h-[30px] w-full items-center gap-1.5 pr-2 text-left text-[13px] transition-colors ${
                    selected
                      ? 'bg-[var(--notion-line)] text-[var(--notion-text)]'
                      : 'text-[var(--notion-text-soft)]'
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
                  aria-expanded={isDirectory ? isExpanded : undefined}
                >
                  <span className="flex h-5 w-4 shrink-0 items-center justify-center text-[var(--notion-text-faint)]">
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
                        <span className="text-[11px] font-medium text-[var(--notion-text-soft)]">
                          {t(($) => $.workbench.changed)}
                        </span>
                      )}
                    </span>
                  ) : null}
                </button>
              )}
              {isDirectory && isExpanded
                ? renderDirectory(workspaceId, entry.relative_path, depth + 1)
                : null}
            </React.Fragment>
          )
        })}
        {draft?.kind === 'create' && firstFileIndex === -1 && entries.length > 0
          ? renderDraft(workspaceId, parentPath, depth)
          : null}
      </>
    )
  }

  const renderDirectory = (
    workspaceId: string,
    relativePath: string,
    depth: number
  ): React.ReactNode => {
    const key = getDirectoryKey(workspaceId, relativePath)
    const entries = childrenByPath[key]
    const hasDraft = draft?.workspaceId === workspaceId && draft.parentPath === relativePath
    if (hasDraft || entries?.length) return renderEntries(workspaceId, relativePath, depth)
    if (directoryErrors.has(key) && !loading.has(key)) {
      return (
        <div
          className="px-3 py-2 text-xs text-[var(--notion-text-faint)]"
          style={{ paddingLeft: 12 + depth * 18 }}
        >
          {t(($) => $.workbench.couldNotReadTheDirectory)}
          <button
            type="button"
            className="ml-2 text-[var(--notion-text)] underline"
            onClick={() => void loadDirectory(workspaceId, relativePath)}
          >
            {t(($) => $.common.retry)}
          </button>
        </div>
      )
    }
    return (
      <div
        role={entries ? undefined : 'status'}
        className="px-3 py-2 text-xs text-[var(--notion-text-faint)]"
        style={{ paddingLeft: 12 + depth * 18 }}
      >
        {entries
          ? t(($) => $.workbench.thisDirectoryHasNoFiles)
          : t(($) => $.workbench.loadingFiles)}
      </div>
    )
  }

  if (workspaces.length === 0) {
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
    getRelativePath(workspaces, latest.afterPath || latest.beforePath || latest.path)
      .toLowerCase()
      .includes(normalizedQuery)
  )

  return (
    <div
      ref={explorerRef}
      className="flex h-full min-h-0 flex-col border-l border-[var(--notion-line)] bg-[var(--notion-page)]"
    >
      <div className="shrink-0 px-2 pt-2">
        <div
          className="grid h-8 grid-cols-2 rounded-[6px] bg-[var(--notion-surface)] p-0.5"
          data-testid={workbenchSelectors.workspaceExplorerModeSwitch}
        >
          <button
            type="button"
            className={`rounded-[5px] text-[12px] font-medium ${mode === 'all' ? 'bg-[var(--notion-page)] text-[var(--notion-text)] shadow-sm' : 'text-[var(--notion-text-soft)] hover:text-[var(--notion-text)]'}`}
            onClick={() => onModeChange('all')}
          >
            {t(($) => $.common.all)}
          </button>
          <button
            type="button"
            className={`rounded-[5px] text-[12px] font-medium ${mode === 'changed' ? 'bg-[var(--notion-page)] text-[var(--notion-text)] shadow-sm' : 'text-[var(--notion-text-soft)] hover:text-[var(--notion-text)]'}`}
            onClick={() => onModeChange('changed')}
          >
            {t(($) => $.workbench.changesInThisRun)}
            {activeChanges.length}
          </button>
        </div>
      </div>
      <div className="shrink-0 p-2">
        <label className="flex h-8 items-center gap-2 rounded-[6px] border border-[var(--notion-line-strong)] px-2.5 text-[var(--notion-text-faint)]">
          <HiOutlineMagnifyingGlass className="h-4 w-4 shrink-0" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t(($) => $.workbench.filterFiles)}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--notion-text)] outline-none placeholder:text-[var(--notion-text-faint)]"
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
          aria-busy={mode === 'all' && restoringTree}
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
          {mode === 'all' && restoringTree ? (
            <div role="status" className="px-3 py-2 text-xs text-[var(--notion-text-faint)]">
              {t(($) => $.workbench.loadingFiles)}
            </div>
          ) : mode === 'all' ? (
            workspaces.map((workspace) => {
              const name =
                workspace.root_path.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) ||
                workspace.root_path
              const isDirectory = workspace.root_kind !== 'file'
              const isExpanded =
                isDirectory && expandedDirectories[workspace.id]?.includes('') === true
              const root: WorkspaceTreeEntry = {
                id: workspace.id,
                workspace_id: workspace.id,
                kind: isDirectory ? 'directory' : 'file',
                name,
                relative_path: '',
                absolute_path: workspace.root_path,
                supported_for_index: false
              }
              const rootKey = `file:${normalizePath(root.absolute_path)}`
              const selected = selectedKey === rootKey
              const selectRoot = (): void => {
                setContextTarget(root)
                setSelectedKey(rootKey)
              }
              return (
                <div key={workspace.id} data-workspace-root={workspace.id}>
                  <button
                    type="button"
                    className={`flex h-[30px] w-full items-center gap-1.5 px-2 text-left text-[13px] font-medium ${selected ? 'bg-[var(--notion-line)] text-[var(--notion-text)]' : 'text-[var(--notion-text)]'}`}
                    title={root.absolute_path}
                    aria-expanded={isDirectory ? isExpanded : undefined}
                    aria-current={selected || undefined}
                    data-workspace-entry="true"
                    onContextMenu={selectRoot}
                    onKeyDown={(event) => {
                      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                        event.preventDefault()
                        selectRoot()
                        setContextMenuOpen(true)
                      }
                    }}
                    onClick={() => {
                      setSelectedKey(rootKey)
                      if (!isDirectory) {
                        onOpenFile(root)
                        return
                      }
                      toggleDirectory(root)
                    }}
                  >
                    <span className="flex h-5 w-4 shrink-0 items-center justify-center text-[var(--notion-text-faint)]">
                      {isDirectory ? (
                        isExpanded ? (
                          <HiChevronDown className="h-4 w-4" />
                        ) : (
                          <HiChevronRight className="h-4 w-4" />
                        )
                      ) : null}
                    </span>
                    <FileIcon
                      name={name}
                      kind={isDirectory ? 'directory' : undefined}
                      expanded={isExpanded}
                    />
                    <span className="min-w-0 truncate">{name}</span>
                  </button>
                  {isExpanded ? renderDirectory(workspace.id, '', 1) : null}
                </div>
              )
            })
          ) : filteredChanges.length > 0 ? (
            filteredChanges.map(({ latest, records }) => {
              const selected = selectedKey === `change:${latest.id}`
              const isExpanded = expandedChangeGroups.has(latest.id)
              const displayPath = getRelativePath(
                workspaces,
                latest.afterPath || latest.beforePath || latest.path
              )
              return (
                <React.Fragment key={latest.id}>
                  <button
                    type="button"
                    className={`relative flex h-9 w-full items-center gap-2 px-2 text-left text-[13px] transition-colors ${selected ? 'bg-[var(--notion-line)] text-[var(--notion-text)]' : 'text-[var(--notion-text-soft)]'}`}
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
                        className="flex h-6 w-4 shrink-0 items-center justify-center text-[var(--notion-text-faint)]"
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
                      <span className="shrink-0 text-[11px] text-[var(--notion-text-soft)]">
                        {latest.operation === 'deleted'
                          ? t(($) => $.common.deleted)
                          : latest.operation === 'renamed'
                            ? t(($) => $.workbench.renamed)
                            : t(($) => $.workbench.changed)}
                      </span>
                    )}
                    {records.length > 1 ? (
                      <span className="shrink-0 text-[11px] tabular-nums text-[var(--notion-text-faint)]">
                        {records.length}
                        {t(($) => $.workbench.times)}
                      </span>
                    ) : null}
                  </button>
                  {records.length > 1 && isExpanded ? (
                    <div className="border-b border-[var(--notion-line)] bg-[var(--notion-surface-sunken)] py-1">
                      {records.map((record, index) => (
                        <button
                          data-workspace-entry="true"
                          key={record.id}
                          type="button"
                          className={`flex h-8 w-full items-center gap-2 pl-9 pr-2 text-left text-[12px] ${selectedKey === `change:${record.id}` ? 'bg-[var(--notion-line)] text-[var(--notion-text)]' : 'text-[var(--notion-text-soft)]'}`}
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
                          <span className="shrink-0 tabular-nums text-[var(--notion-text-faint)]">
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
            <div className="px-3 py-8 text-center text-xs text-[var(--notion-text-faint)]">
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
