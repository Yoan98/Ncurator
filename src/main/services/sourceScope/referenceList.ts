import path from 'path'
import type {
  DirectoryReference,
  FileReference,
  KbAvailability,
  ListReferenceItemsRequest,
  ReferenceItemListResponse,
  SelectedReference,
  WorkspaceFileIndexRecord,
  WorkspaceSource,
  WorkspaceTreeEntry
} from '../../../shared/types'
import { REFERENCE_ITEM_PAGE_SIZE as DEFAULT_PAGE_SIZE } from '../../../shared/types'
import { buildWebReferenceItem } from './selection'
import { WorkspaceEntryFilter } from '../workspace/workspaceEntryBlacklist'

/** 相对工作地址根的最大路径深度（根为 0，根下第一层为 1，再下一层为 2） */
const MAX_REFERENCE_PATH_DEPTH = 2

const isIndexedWorkspaceFile = (record?: WorkspaceFileIndexRecord): boolean =>
  Boolean(record && record.index_status === 'indexed' && record.document_id)

const resolveDirectoryAvailability = (fileCount: number, indexedCount: number): KbAvailability => {
  if (fileCount === 0 || indexedCount === 0) return 'not_indexed'
  if (indexedCount === fileCount) return 'indexed'
  return 'partial'
}

const toEntryId = (workspaceId: string, kind: 'directory' | 'file', relativePath: string): string =>
  `${workspaceId}:${kind}:${relativePath}`

const normalizeRelativePath = (value: string): string =>
  String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')

const pathDepth = (relativePath: string): number =>
  normalizeRelativePath(relativePath).split('/').filter(Boolean).length

type ReferenceRoot = ReferenceItemListResponse['workspaceRoots'][string]

const normalizeQuery = (value: string): string => value.trim().toLowerCase().replaceAll('\\', '/')

const matchRank = (reference: SelectedReference, query: string, root?: ReferenceRoot): number => {
  const name = normalizeQuery(reference.name)
  if (!query || name === query) return 0
  if (reference.kind === 'file' && path.basename(name, path.extname(name)) === query) return 1
  if (name.startsWith(query)) return 2
  if (name.includes(query)) return 3
  if (reference.kind === 'web') return normalizeQuery(reference.url).includes(query) ? 4 : Infinity
  if (normalizeQuery(reference.relativePath).includes(query)) return 4
  if (query.includes('/')) {
    const displayPath = [root?.name, reference.relativePath].filter(Boolean).join('/')
    if (
      [displayPath, reference.absolutePath].some((candidate) =>
        normalizeQuery(candidate).includes(query)
      )
    )
      return 4
  }
  return Infinity
}

export const buildDirectoryReferenceFromRecords = (input: {
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

const entryToReference = (input: {
  workspace: WorkspaceSource
  entry: WorkspaceTreeEntry
  records: WorkspaceFileIndexRecord[]
}): SelectedReference =>
  input.entry.kind === 'directory'
    ? buildDirectoryReferenceFromRecords({
        workspace: input.workspace,
        name: input.entry.name,
        relativePath: input.entry.relative_path,
        absolutePath: input.entry.absolute_path,
        records: input.records
      })
    : buildFileReferenceFromEntry(input)

const paginate = (
  items: SelectedReference[],
  roots: ReferenceItemListResponse['workspaceRoots'],
  offset: number,
  limit: number
): ReferenceItemListResponse => {
  const safeOffset = Math.max(0, Math.floor(offset))
  const safeLimit = Math.min(DEFAULT_PAGE_SIZE, Math.max(1, Math.floor(limit) || DEFAULT_PAGE_SIZE))
  const slice = items.slice(safeOffset, safeOffset + safeLimit)
  return {
    items: slice,
    workspaceRoots: Object.fromEntries(
      slice.flatMap((item) =>
        item.kind === 'web' ? [] : [[item.workspaceId, roots[item.workspaceId]]]
      )
    ),
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
  listWebSources: () => Promise<Parameters<typeof buildWebReferenceItem>[0][]>
  normalizeWorkspaceRoot: (rootPath: string) => Promise<{
    normalizedRootPath: string
    displayName: string
    kind: 'file' | 'directory'
  }>
}

const allowKind = (
  kind: SelectedReference['kind'],
  filters: Set<SelectedReference['kind']> | null
): boolean => !filters || filters.has(kind)

/** 收集单个工作地址内深度 ≤ 2 的扁平候选（含根目录本身） */
const collectWorkspaceShallowReferences = async (
  deps: ReferenceListDeps,
  workspace: WorkspaceSource,
  kindFilters: Set<SelectedReference['kind']> | null,
  roots: ReferenceItemListResponse['workspaceRoots']
): Promise<SelectedReference[]> => {
  if (!workspace.root_path) return []
  const normalized = await deps.normalizeWorkspaceRoot(workspace.root_path)
  const filter = new WorkspaceEntryFilter(normalized.normalizedRootPath)
  if (await filter.isIgnored('', normalized.kind)) return []
  roots[workspace.id] = { name: normalized.displayName, path: normalized.normalizedRootPath }
  const records = await deps.listWorkspaceFileIndexRecords(workspace.id)

  if (normalized.kind === 'file') {
    if (!allowKind('file', kindFilters)) return []
    const name = path.basename(normalized.normalizedRootPath)
    const record = records.find((item) => item.relative_path === name)
    const file: FileReference = {
      kind: 'file',
      workspaceId: workspace.id,
      nodeId: toEntryId(workspace.id, 'file', name),
      name,
      relativePath: name,
      absolutePath: normalized.normalizedRootPath,
      fileExt: path.extname(name).slice(1) || undefined,
      kbDocumentIds:
        isIndexedWorkspaceFile(record) && record?.document_id ? [record.document_id] : [],
      kbAvailability: isIndexedWorkspaceFile(record) ? 'indexed' : 'not_indexed'
    }
    return [file]
  }

  const items: SelectedReference[] = []
  if (allowKind('directory', kindFilters)) {
    items.push(
      buildDirectoryReferenceFromRecords({
        workspace,
        name: normalized.displayName,
        relativePath: '',
        absolutePath: normalized.normalizedRootPath,
        records
      })
    )
  }

  const depth1 = await deps.listDirectory({
    workspaceId: workspace.id,
    rootPath: workspace.root_path,
    relativePath: ''
  })
  const depth1Dirs: WorkspaceTreeEntry[] = []
  for (const entry of depth1) {
    if (pathDepth(entry.relative_path) > MAX_REFERENCE_PATH_DEPTH) continue
    if (entry.kind === 'directory') depth1Dirs.push(entry)
    if (!allowKind(entry.kind, kindFilters)) continue
    items.push(entryToReference({ workspace, entry, records }))
  }

  for (const dir of depth1Dirs) {
    const depth2 = await deps.listDirectory({
      workspaceId: workspace.id,
      rootPath: workspace.root_path,
      relativePath: dir.relative_path
    })
    for (const entry of depth2) {
      if (pathDepth(entry.relative_path) > MAX_REFERENCE_PATH_DEPTH) continue
      if (!allowKind(entry.kind, kindFilters)) continue
      items.push(entryToReference({ workspace, entry, records }))
    }
  }

  return items
}

export const listReferenceItemsPage = async (
  deps: ReferenceListDeps,
  request: ListReferenceItemsRequest,
  kindFilters: Set<SelectedReference['kind']> | null
): Promise<ReferenceItemListResponse> => {
  const query = normalizeQuery(request.query ?? '')
  const offset = Number(request.offset) || 0
  const limit = Number(request.limit) || DEFAULT_PAGE_SIZE

  const workspaces = await deps.listWorkspaces()
  const roots: ReferenceItemListResponse['workspaceRoots'] = {}
  const groups: SelectedReference[][] = []
  for (const workspace of workspaces) {
    groups.push(await collectWorkspaceShallowReferences(deps, workspace, kindFilters, roots))
  }
  if (allowKind('web', kindFilters))
    groups.push((await deps.listWebSources()).map(buildWebReferenceItem))
  const rankedGroups = groups
    .map((group) =>
      group
        .map((item) => ({
          item,
          rank: matchRank(item, query, item.kind === 'web' ? undefined : roots[item.workspaceId])
        }))
        .filter(({ rank }) => Number.isFinite(rank))
        .sort((left, right) => left.rank - right.rank)
    )
    .filter((group) => group.length > 0)
  rankedGroups.sort((left, right) => left[0].rank - right[0].rank)
  const items = rankedGroups.flatMap((group) => group.map(({ item }) => item))
  return paginate(items, roots, offset, limit)
}
