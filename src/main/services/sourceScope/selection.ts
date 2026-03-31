import type {
  DirectoryReference,
  FileReference,
  KbAvailability,
  SelectedReference,
  WebReference,
  WebSourceRecord,
  WorkspaceNode,
  WorkspaceSource
} from '../../../shared/types'

export const getWorkspaceScopeKey = (node: Pick<WorkspaceNode, 'kind' | 'relative_path'>): string =>
  `${node.kind}:${node.relative_path}`

const isIndexedWorkspaceFile = (node: WorkspaceNode): boolean =>
  node.kind === 'file' && node.prepare_status === 'prepared' && Boolean(node.document_id)

const collectIndexedFileNodes = (nodes: WorkspaceNode[]): WorkspaceNode[] =>
  nodes.filter(isIndexedWorkspaceFile)

const collectIndexedDocumentIds = (nodes: WorkspaceNode[]): string[] =>
  Array.from(
    new Set(
      collectIndexedFileNodes(nodes)
        .map((node) => node.document_id)
        .filter(Boolean)
    )
  ) as string[]

const collectNotIndexedFileCount = (nodes: WorkspaceNode[]): number =>
  nodes.filter((node) => node.kind === 'file' && !isIndexedWorkspaceFile(node)).length

const resolveDirectoryAvailability = (nodes: WorkspaceNode[]): KbAvailability => {
  const fileCount = nodes.filter((node) => node.kind === 'file').length
  const indexedCount = collectIndexedFileNodes(nodes).length
  if (fileCount === 0 || indexedCount === 0) return 'not_indexed'
  if (indexedCount === fileCount) return 'indexed'
  return 'partial'
}

export const isLocalReference = (reference: SelectedReference): boolean => reference.kind !== 'web'

export const buildWorkspaceDefaultDocumentIds = (nodes: WorkspaceNode[]): string[] =>
  collectIndexedDocumentIds(nodes.filter((node) => node.kind === 'file'))

export const shouldIncludeReferenceInSearch = (reference: SelectedReference): boolean =>
  reference.kbDocumentIds.length > 0

export const referenceMatchesQuery = (
  reference: SelectedReference,
  rawQuery?: string
): boolean => {
  const query = String(rawQuery || '').trim().toLowerCase()
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

export const buildWorkspaceReferenceItems = (
  workspace: WorkspaceSource,
  nodes: WorkspaceNode[]
): SelectedReference[] => {
  const fileNodes = nodes.filter((node) => node.kind === 'file')
  const directoryNodes = nodes.filter((node) => node.kind === 'directory')

  const directoryReferences: DirectoryReference[] = directoryNodes.map((node) => {
    const descendantFiles = fileNodes.filter((fileNode) =>
      fileNode.relative_path.startsWith(`${node.relative_path}/`)
    )
    const indexedFileCount = collectIndexedFileNodes(descendantFiles).length
    const notIndexedFileCount = collectNotIndexedFileCount(descendantFiles)

    return {
      kind: 'directory',
      workspaceId: workspace.id,
      nodeId: node.id,
      name: node.name,
      relativePath: node.relative_path,
      absolutePath: node.absolute_path,
      kbDocumentIds: collectIndexedDocumentIds(descendantFiles),
      kbAvailability: resolveDirectoryAvailability(descendantFiles),
      indexedFileCount,
      notIndexedFileCount
    }
  })

  const fileReferences: FileReference[] = fileNodes.map((node) => ({
    kind: 'file',
    workspaceId: workspace.id,
    nodeId: node.id,
    name: node.name,
    relativePath: node.relative_path,
    absolutePath: node.absolute_path,
    fileExt: node.file_ext || undefined,
    kbDocumentIds: isIndexedWorkspaceFile(node) && node.document_id ? [node.document_id] : [],
    kbAvailability: isIndexedWorkspaceFile(node) ? 'indexed' : 'not_indexed'
  }))

  return [...directoryReferences, ...fileReferences]
}

export const buildWebReferenceItem = (source: WebSourceRecord): WebReference => ({
  kind: 'web',
  webSourceId: source.id,
  name: source.title || source.url,
  url: source.url,
  kbDocumentIds: source.document_id && source.import_status === 2 ? [source.document_id] : [],
  kbAvailability: source.document_id && source.import_status === 2 ? 'indexed' : 'not_indexed'
})
