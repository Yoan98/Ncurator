import path from 'path'
import type {
  DirectoryReference,
  FileReference,
  KbAvailability,
  ListReferenceItemsRequest,
  ReferenceItemListResponse,
  ReferenceListParent,
  SelectedReference,
  WorkspaceFileIndexRecord,
  WorkspaceSource,
  WorkspaceTreeEntry
} from '../../../shared/types'
import { REFERENCE_ITEM_PAGE_SIZE as DEFAULT_PAGE_SIZE } from '../../../shared/types'
import {
  buildWebReferenceItem,
  buildWorkspaceReferenceItemsFromCurrentTree
} from './selection'

const isIndexedWorkspaceFile = (record?: WorkspaceFileIndexRecord): boolean =>
  Boolean(record && record.index_status === 'indexed' && record.document_id)

const resolveDirectoryAvailability = (fileCount: number, indexedCount: number): KbAvailability => {
  if (fileCount === 0 || indexedCount === 0) return 'not_indexed'
  if (indexedCount === fileCount) return 'indexed'
  return 'partial'
}

const toEntryId = (
  workspaceId: string,
  kind: 'directory' | 'file',
  relativePath: string
): string => `${workspaceId}:${kind}:${relativePath}`

const normalizeRelativePath = (value: string): string =>
  String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')

const matchesQuery = (reference: SelectedReference, query: string): boolean => {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true
  const values =
    reference.kind === 'web'
      ? [reference.name, reference.url]
      : [reference.name, reference.relativePath, reference.absolutePath]
  return values.some((value) =>
    String(value || '')
      .toLowerCase()
      .includes(normalized)
  )
}

const buildDirectoryReferenceFromRecords = (input: {
  workspace: WorkspaceSource
  name: string
  relativePath: string
  absolutePath: string
  records: WorkspaceFileIndexRecord[]
}): DirectoryReference => {
  const relativePath = normalizeRelativePath(input.relativePath)
  const prefix = relativePath ? `${relativePath}/` : ''
  const related = input.records.filter((record) =>
    relativePath ? record.relative_path.startsWith(prefix) : true
  )
  const indexedRecords = related.filter((record) => isIndexedWorkspaceFile(record))
  return {
    kind: 'directory',
    workspaceId: input.workspace.id,
    nodeId: toEntryId(input.workspace.id, 'directory', relativePath),
    name: input.name,
    relativePath,
    absolutePath: input.absolutePath,
    kbDocumentIds: Array.from(
      new Set(
        indexedRecords
          .map((record) => record.document_id)
          .filter((documentId): documentId is string => Boolean(documentId))
      )
    ),
    kbAvailability: resolveDirectoryAvailability(related.length, indexedRecords.length),
    indexedFileCount: indexedRecords.length,
    notIndexedFileCount: related.length - indexedRecords.length
  }
}

const buildFileReferenceFromEntry = (input: {
  workspace: WorkspaceSource
  entry: WorkspaceTreeEntry
  records: WorkspaceFileIndexRecord[]
}): FileReference => {
  const record = input.records.find((item) => item.relative_path === input.entry.relative_path)
  return {
    kind: 'file',
    workspaceId: input.workspace.id,
    nodeId: input.entry.id,
    name: input.entry.name,
    relativePath: input.entry.relative_path,
    absolutePath: input.entry.absolute_path,
    fileExt: input.entry.file_ext || undefined,
    kbDocumentIds:
      isIndexedWorkspaceFile(record) && record?.document_id ? [record.document_id] : [],
    kbAvailability: isIndexedWorkspaceFile(record) ? 'indexed' : 'not_indexed'
  }
}

const buildReferencesFromEntries = (input: {
  workspace: WorkspaceSource
  entries: WorkspaceTreeEntry[]
  records: WorkspaceFileIndexRecord[]
}): SelectedReference[] => {
  const directories = input.entries.filter((entry) => entry.kind === 'directory')
  const files = input.entries.filter((entry) => entry.kind === 'file')
  return [
    ...directories.map((entry) =>
      buildDirectoryReferenceFromRecords({
        workspace: input.workspace,
        name: entry.name,
        relativePath: entry.relative_path,
        absolutePath: entry.absolute_path,
        records: input.records
      })
    ),
    ...files.map((entry) =>
      buildFileReferenceFromEntry({
        workspace: input.workspace,
        entry,
        records: input.records
      })
    )
  ]
}

const paginate = (
  items: SelectedReference[],
  offset: number,
  limit: number
): ReferenceItemListResponse => {
  const safeOffset = Math.max(0, Math.floor(offset))
  const safeLimit = Math.min(DEFAULT_PAGE_SIZE, Math.max(1, Math.floor(limit) || DEFAULT_PAGE_SIZE))
  const slice = items.slice(safeOffset, safeOffset + safeLimit)
  return {
    items: slice,
    total: items.length,
    hasMore: safeOffset + slice.length < items.length,
    offset: safeOffset,
    limit: safeLimit
  }
}

export type ReferenceListDeps = {
  listWorkspaces: () => Promise<WorkspaceSource[]>
  listWorkspaceFileIndexRecords: (workspaceId: string) => Promise<WorkspaceFileIndexRecord[]>
  listDirectory: (input: {
    workspaceId: string
    rootPath: string
    relativePath?: string
  }) => Promise<WorkspaceTreeEntry[]>
  scanWorkspaceTree: (input: {
    workspaceId: string
    rootPath: string
  }) => Promise<{ workspace: WorkspaceSource; entries: WorkspaceTreeEntry[] }>
  listWebSources: () => Promise<Parameters<typeof buildWebReferenceItem>[0][]>
  normalizeWorkspaceRoot: (rootPath: string) => Promise<{
    normalizedRootPath: string
    displayName: string
    kind: 'file' | 'directory'
  }>
}

const resolveParent = (parent?: ReferenceListParent): ReferenceListParent =>
  parent && typeof parent === 'object' && 'type' in parent ? parent : { type: 'roots' }

const allowKind = (
  kind: SelectedReference['kind'],
  filters: Set<SelectedReference['kind']> | null
): boolean => !filters || filters.has(kind)

export const listReferenceItemsPage = async (
  deps: ReferenceListDeps,
  request: ListReferenceItemsRequest,
  kindFilters: Set<SelectedReference['kind']> | null
): Promise<ReferenceItemListResponse> => {
  const query = String(request.query || '').trim()
  const offset = Number(request.offset) || 0
  const limit = Number(request.limit) || DEFAULT_PAGE_SIZE
  const parent = resolveParent(request.parent)

  if (query) {
    const workspaces = await deps.listWorkspaces()
    const local: SelectedReference[] = []
    for (const workspace of workspaces) {
      if (!workspace.root_path) continue
      if (!allowKind('directory', kindFilters) && !allowKind('file', kindFilters)) break
      const [scanResult, records] = await Promise.all([
        deps.scanWorkspaceTree({ workspaceId: workspace.id, rootPath: workspace.root_path }),
        deps.listWorkspaceFileIndexRecords(workspace.id)
      ])
      local.push(
        ...buildWorkspaceReferenceItemsFromCurrentTree({
          workspace: scanResult.workspace,
          entries: scanResult.entries,
          records
        })
      )
    }
    const web = allowKind('web', kindFilters)
      ? (await deps.listWebSources()).map(buildWebReferenceItem)
      : []
    const matched = [...local, ...web]
      .filter((item) => allowKind(item.kind, kindFilters))
      .filter((item) => matchesQuery(item, query))
    return paginate(matched, offset, limit)
  }

  if (parent.type === 'web') {
    if (!allowKind('web', kindFilters)) {
      return paginate([], offset, limit)
    }
    const web = (await deps.listWebSources()).map(buildWebReferenceItem)
    return paginate(web, offset, limit)
  }

  if (parent.type === 'workspace') {
    const workspaces = await deps.listWorkspaces()
    const workspace = workspaces.find((item) => item.id === parent.workspaceId)
    if (!workspace?.root_path) return paginate([], offset, limit)
    const relativePath = normalizeRelativePath(parent.relativePath)
    const [entries, records] = await Promise.all([
      deps.listDirectory({
        workspaceId: workspace.id,
        rootPath: workspace.root_path,
        relativePath
      }),
      deps.listWorkspaceFileIndexRecords(workspace.id)
    ])
    const items = buildReferencesFromEntries({ workspace, entries, records }).filter((item) =>
      allowKind(item.kind, kindFilters)
    )
    return paginate(items, offset, limit)
  }

  // roots: workspace roots then web
  const workspaces = await deps.listWorkspaces()
  const roots: SelectedReference[] = []
  for (const workspace of workspaces) {
    if (!workspace.root_path) continue
    const normalized = await deps.normalizeWorkspaceRoot(workspace.root_path)
    const records = await deps.listWorkspaceFileIndexRecords(workspace.id)
    if (normalized.kind === 'file') {
      if (!allowKind('file', kindFilters)) continue
      const name = path.basename(normalized.normalizedRootPath)
      roots.push({
        kind: 'file',
        workspaceId: workspace.id,
        nodeId: toEntryId(workspace.id, 'file', name),
        name,
        relativePath: name,
        absolutePath: normalized.normalizedRootPath,
        fileExt: path.extname(name).slice(1) || undefined,
        kbDocumentIds: [],
        kbAvailability: 'not_indexed'
      })
      const record = records.find((item) => item.relative_path === name)
      if (isIndexedWorkspaceFile(record) && record?.document_id) {
        const last = roots[roots.length - 1]
        if (last && last.kind === 'file') {
          last.kbDocumentIds = [record.document_id]
          last.kbAvailability = 'indexed'
        }
      }
      continue
    }
    if (!allowKind('directory', kindFilters)) continue
    roots.push(
      buildDirectoryReferenceFromRecords({
        workspace,
        name: normalized.displayName,
        relativePath: '',
        absolutePath: normalized.normalizedRootPath,
        records
      })
    )
  }
  const web = allowKind('web', kindFilters)
    ? (await deps.listWebSources()).map(buildWebReferenceItem)
    : []
  return paginate([...roots, ...web], offset, limit)
}
