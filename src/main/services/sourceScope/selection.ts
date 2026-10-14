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

const isIndexedWorkspaceFile = (record?: WorkspaceFileIndexRecord): boolean =>
  Boolean(record && record.index_status === 'indexed' && record.document_id)

const resolveDirectoryAvailability = (fileCount: number, indexedCount: number): KbAvailability => {
  if (fileCount === 0 || indexedCount === 0) return 'not_indexed'
  if (indexedCount === fileCount) return 'indexed'
  return 'partial'
}

const buildWorkspaceReferenceItems = (input: {
  workspace: WorkspaceSource
  entries: WorkspaceTreeEntry[]
  records: WorkspaceFileIndexRecord[]
}): SelectedReference[] => {
  const { workspace, entries, records } = input
  const directoryEntries = entries.filter((entry) => entry.kind === 'directory')
  const fileEntries = entries.filter((entry) => entry.kind === 'file')
  const recordMap = new Map(records.map((record) => [record.relative_path, record] as const))

  const directoryReferences: DirectoryReference[] = directoryEntries.map((entry) => {
    const descendantFiles = fileEntries.filter((file) =>
      file.relative_path.startsWith(`${entry.relative_path}/`)
    )
    const indexableFiles = descendantFiles.filter((file) => file.supported_for_index)
    const indexedRecords = indexableFiles
      .map((file) => recordMap.get(file.relative_path))
      .filter((record): record is WorkspaceFileIndexRecord => isIndexedWorkspaceFile(record))
    const indexedFileCount = indexedRecords.length
    const notIndexedFileCount = indexableFiles.length - indexedFileCount

    return {
      kind: 'directory',
      workspaceId: workspace.id,
      nodeId: entry.id,
      name: entry.name,
      relativePath: entry.relative_path,
      absolutePath: entry.absolute_path,
      kbDocumentIds: Array.from(
        new Set(
          indexedRecords
            .map((record) => record.document_id)
            .filter((documentId): documentId is string => Boolean(documentId))
        )
      ),
      kbAvailability: resolveDirectoryAvailability(indexableFiles.length, indexedFileCount),
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

/**
 * Builds @ candidates from the current filesystem tree. Persisted index records only provide
 * knowledge-base availability; they never decide which local files can be selected.
 */
export const buildWorkspaceReferenceItemsFromCurrentTree = (input: {
  workspace: WorkspaceSource
  entries: WorkspaceTreeEntry[]
  records: WorkspaceFileIndexRecord[]
}): SelectedReference[] => {
  const entryMap = new Map(
    input.entries
      .filter((entry) => entry.kind === 'file' && entry.supported_for_index)
      .map((entry) => [entry.relative_path, entry] as const)
  )
  const currentRecords = input.records.flatMap((record) => {
    const entry = entryMap.get(record.relative_path)
    if (!entry) return []

    const matchesIndexedSnapshot = record.size === entry.size && record.mtime_ms === entry.mtime_ms
    if (matchesIndexedSnapshot) return [{ ...record, absolute_path: entry.absolute_path }]

    return [
      {
        ...record,
        absolute_path: entry.absolute_path,
        size: entry.size,
        mtime_ms: entry.mtime_ms,
        index_status: 'needs_index' as const
      }
    ]
  })

  return buildWorkspaceReferenceItems({
    workspace: input.workspace,
    entries: input.entries,
    records: currentRecords
  })
}

export const buildWebReferenceItem = (source: WebSourceRecord): WebReference => ({
  kind: 'web',
  webSourceId: source.id,
  name: source.title || source.url,
  url: source.url,
  kbDocumentIds:
    source.document_id && source.index_status === 'indexed' ? [source.document_id] : [],
  kbAvailability:
    source.document_id && source.index_status === 'indexed' ? 'indexed' : 'not_indexed'
})
