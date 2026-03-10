import type {
  SourceScopeSelection,
  WebSourceRecord,
  WorkspaceNode,
  WorkspaceRuntimeBinding,
  WorkspaceSource
} from '../../../shared/types'

export const getWorkspaceScopeKey = (node: Pick<WorkspaceNode, 'kind' | 'relative_path'>): string =>
  `${node.kind}:${node.relative_path}`

export const collectPreparedDocumentIds = (nodes: WorkspaceNode[]): string[] =>
  Array.from(
    new Set(
      nodes
        .filter((node) => node.prepare_status === 'prepared')
        .map((node) => node.document_id)
        .filter(Boolean)
    )
  ) as string[]

export const collectUnpreparedFileCount = (nodes: WorkspaceNode[]): number =>
  nodes.filter(
    (node) => node.kind === 'file' && (node.prepare_status !== 'prepared' || !node.document_id)
  ).length

export const shouldIncludeScopeInSearch = (scope: SourceScopeSelection): boolean =>
  scope.documentIds.length > 0 && !scope.hasUnpreparedFiles

export const scopeMatchesQuery = (scope: SourceScopeSelection, rawQuery?: string): boolean => {
  const query = String(rawQuery || '').trim().toLowerCase()
  if (!query) return true
  return [scope.label, scope.relativePath, scope.absolutePath]
    .map((value) => String(value || '').toLowerCase())
    .some((value) => value.includes(query))
}

export const collectScopeDocumentIds = (scopes?: SourceScopeSelection[]): string[] =>
  Array.from(
    new Set(
      (scopes || []).flatMap((scope) =>
        Array.isArray(scope.documentIds) ? scope.documentIds.map((item) => String(item).trim()) : []
      )
    )
  ).filter(Boolean)

export const buildWorkspaceScopeSelections = (
  workspace: WorkspaceSource,
  nodes: WorkspaceNode[]
): SourceScopeSelection[] => {
  const workspaceBinding: WorkspaceRuntimeBinding = {
    workspaceId: workspace.id,
    rootPath: workspace.root_path
  }
  const fileNodes = nodes.filter((node) => node.kind === 'file')
  const directoryNodes = nodes.filter((node) => node.kind === 'directory')
  const workspaceDocumentIds = collectPreparedDocumentIds(fileNodes)
  const workspaceUnpreparedFileCount = collectUnpreparedFileCount(fileNodes)

  const workspaceScope: SourceScopeSelection = {
    scopeType: 'workspace',
    sourceType: 'workspace',
    sourceId: workspace.id,
    label: workspace.name,
    absolutePath: workspace.root_path,
    documentIds: workspaceDocumentIds,
    hasUnpreparedFiles: workspaceUnpreparedFileCount > 0,
    preparedDocumentCount: workspaceDocumentIds.length,
    unpreparedFileCount: workspaceUnpreparedFileCount,
    workspace: workspaceBinding
  }

  const directoryScopes = directoryNodes.map((node) => {
    const descendantFiles = fileNodes.filter((fileNode) =>
      fileNode.relative_path.startsWith(`${node.relative_path}/`)
    )
    const documentIds = collectPreparedDocumentIds(descendantFiles)
    const unpreparedFileCount = collectUnpreparedFileCount(descendantFiles)
    return {
      scopeType: 'directory',
      sourceType: 'workspace',
      sourceId: workspace.id,
      nodeId: node.id,
      label: node.name,
      absolutePath: node.absolute_path,
      relativePath: node.relative_path,
      documentIds,
      hasUnpreparedFiles: unpreparedFileCount > 0,
      preparedDocumentCount: documentIds.length,
      unpreparedFileCount,
      workspace: workspaceBinding
    } satisfies SourceScopeSelection
  })

  const fileScopes = fileNodes.map((node) => ({
    scopeType: 'file',
    sourceType: 'workspace',
    sourceId: workspace.id,
    nodeId: node.id,
    label: node.name,
    absolutePath: node.absolute_path,
    relativePath: node.relative_path,
    documentIds: node.prepare_status === 'prepared' && node.document_id ? [node.document_id] : [],
    hasUnpreparedFiles: node.prepare_status !== 'prepared' || !node.document_id,
    preparedDocumentCount: node.prepare_status === 'prepared' && node.document_id ? 1 : 0,
    unpreparedFileCount: node.prepare_status === 'prepared' && node.document_id ? 0 : 1,
    workspace: workspaceBinding
  })) satisfies SourceScopeSelection[]

  return [workspaceScope, ...directoryScopes, ...fileScopes]
}

export const buildWebScopeSelection = (source: WebSourceRecord): SourceScopeSelection | null => {
  if (!source.document_id || source.import_status !== 2) return null
  return {
    scopeType: 'web',
    sourceType: 'web',
    sourceId: source.id,
    label: source.title || source.url,
    absolutePath: source.url,
    documentIds: [source.document_id],
    hasUnpreparedFiles: false,
    preparedDocumentCount: 1,
    unpreparedFileCount: 0
  }
}
