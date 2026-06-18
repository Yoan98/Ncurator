import type {
  DirectoryReference,
  FileReference,
  KbAvailability,
  SelectedReference,
  WebReference,
  WebSourceRecord,
  WorkspaceFileIndexRecord,
  WorkspaceSource,
  WorkspaceTreeEntry
} from '../../../shared/types'

export const getWorkspaceScopeKey = (
  node: Pick<WorkspaceTreeEntry, 'kind' | 'relative_path'>
): string => `${node.kind}:${node.relative_path}`

const isIndexedWorkspaceFile = (record?: WorkspaceFileIndexRecord): boolean =>
  Boolean(record && record.index_status === 'indexed' && record.document_id)

const collectIndexedFileRecords = (
  records: WorkspaceFileIndexRecord[]
): WorkspaceFileIndexRecord[] => records.filter((record) => isIndexedWorkspaceFile(record))

const collectIndexedDocumentIds = (records: WorkspaceFileIndexRecord[]): string[] =>
  Array.from(
    new Set(
      collectIndexedFileRecords(records)
        .map((record) => record.document_id)
        .filter(Boolean)
    )
  ) as string[]

const collectNotIndexedFileCount = (records: WorkspaceFileIndexRecord[]): number =>
  records.filter((record) => !isIndexedWorkspaceFile(record)).length

const resolveDirectoryAvailability = (records: WorkspaceFileIndexRecord[]): KbAvailability => {
  const fileCount = records.length
  const indexedCount = collectIndexedFileRecords(records).length
  if (fileCount === 0 || indexedCount === 0) return 'not_indexed'
  if (indexedCount === fileCount) return 'indexed'
  return 'partial'
}

export const isLocalReference = (reference: SelectedReference): boolean => reference.kind !== 'web'

export const buildWorkspaceDefaultDocumentIds = (records: WorkspaceFileIndexRecord[]): string[] =>
  collectIndexedDocumentIds(records)

export const referenceMatchesQuery = (reference: SelectedReference, rawQuery?: string): boolean => {
  const query = String(rawQuery || '')
    .trim()
    .toLowerCase()
  if (!query) return true

  const values =
    reference.kind === 'web'
      ? [reference.name, reference.url]
      : [reference.name, reference.relativePath, reference.absolutePath]

  return values
    .map((value) => String(value || '').toLowerCase())
    .some((value) => value.includes(query))
}

export const collectReferenceDocumentIds = (references?: SelectedReference[]): string[] =>
  Array.from(
    new Set(
      (references || []).flatMap((reference) =>
        Array.isArray(reference.kbDocumentIds)
          ? reference.kbDocumentIds.map((item) => String(item).trim())
          : []
      )
    )
  ).filter(Boolean)

export const buildWorkspaceReferenceItems = (input: {
  workspace: WorkspaceSource
  entries: WorkspaceTreeEntry[]
  records: WorkspaceFileIndexRecord[]
}): SelectedReference[] => {
  const { workspace, entries, records } = input
  const directoryEntries = entries.filter((entry) => entry.kind === 'directory')
  const fileEntries = entries.filter((entry) => entry.kind === 'file')
  const recordMap = new Map(records.map((record) => [record.relative_path, record] as const))

  const directoryReferences: DirectoryReference[] = directoryEntries.map((entry) => {
    const descendantRecords = records.filter((record) =>
      record.relative_path.startsWith(`${entry.relative_path}/`)
    )
    const indexedFileCount = collectIndexedFileRecords(descendantRecords).length
    const notIndexedFileCount = collectNotIndexedFileCount(descendantRecords)

    return {
      kind: 'directory',
      workspaceId: workspace.id,
      nodeId: entry.id,
      name: entry.name,
      relativePath: entry.relative_path,
      absolutePath: entry.absolute_path,
      kbDocumentIds: collectIndexedDocumentIds(descendantRecords),
      kbAvailability: resolveDirectoryAvailability(descendantRecords),
      indexedFileCount,
      notIndexedFileCount
    }
  })

  const fileReferences: FileReference[] = fileEntries.map((entry) => {
    const record = recordMap.get(entry.relative_path)
    return {
      kind: 'file',
      workspaceId: workspace.id,
      nodeId: entry.id,
      name: entry.name,
      relativePath: entry.relative_path,
      absolutePath: entry.absolute_path,
      fileExt: entry.file_ext || undefined,
      kbDocumentIds:
        isIndexedWorkspaceFile(record) && record?.document_id ? [record.document_id] : [],
      kbAvailability: isIndexedWorkspaceFile(record) ? 'indexed' : 'not_indexed'
    }
  })

  return [...directoryReferences, ...fileReferences]
}

export const buildWebReferenceItem = (source: WebSourceRecord): WebReference => ({
  kind: 'web',
  workspaceId: source.workspace_id,
  webSourceId: source.id,
  name: source.title || source.url,
  url: source.url,
  kbDocumentIds:
    source.document_id && source.index_status === 'indexed' ? [source.document_id] : [],
  kbAvailability:
    source.document_id && source.index_status === 'indexed' ? 'indexed' : 'not_indexed'
})
