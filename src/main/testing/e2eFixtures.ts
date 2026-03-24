import type {
  AiPlanTask,
  DeleteWorkspaceSourceResponse,
  DeleteWebSourceResponse,
  ListSourceScopesRequest,
  SearchResponse,
  SearchResult,
  SourceScopeListResponse,
  SourceScopeSelection,
  WebIngestPayload,
  WebSourceListResponse,
  WebSourceMutationResponse,
  WebSourceRecord,
  WorkspaceJobResponse,
  WorkspaceMutationResponse,
  WorkspaceNode,
  WorkspaceNodeListResponse,
  WorkspacePrepareMode,
  WorkspaceSource,
  WorkspaceListResponse
} from '../../shared/types'

export type E2EChatScenario =
  | 'chat-plan-artifact'
  | 'chat-approval'
  | 'chat-workspace'
  | 'chat-edit-review'
  | 'chat-review-conflict'
export type E2ESearchScenario = 'search-results'

const E2E_CHAT_SCENARIO_PREFIXES: Record<E2EChatScenario, string> = {
  'chat-plan-artifact': '[e2e:chat-plan-artifact]',
  'chat-approval': '[e2e:chat-approval]',
  'chat-workspace': '[e2e:chat-workspace]',
  'chat-edit-review': '[e2e:chat-edit-review]',
  'chat-review-conflict': '[e2e:chat-review-conflict]'
}

const E2E_SEARCH_SCENARIO_PREFIXES: Record<E2ESearchScenario, string> = {
  'search-results': '[e2e:search-results]'
}

const E2E_IMPORT_WORKSPACE_ID = 'e2e-import-workspace-1'
const E2E_IMPORT_DOCUMENT_ID = 'e2e-import-doc-1'
const E2E_SEARCH_DOCUMENT_ID = 'e2e-search-doc-1'
const E2E_IMPORT_ROOT_PATH = '/tmp/ncurator-e2e-import-workspace'
const E2E_WORKSPACE_SCAN_ERROR_MARKER = 'scan-fail'
const E2E_WORKSPACE_PREPARE_ERROR_MARKER = 'prepare-fail'

type E2EWorkspaceFixtureMode = 'normal' | 'scan_error' | 'prepare_error'

export const E2E_CHAT_WORKSPACE_SCOPE: SourceScopeSelection = {
  scopeType: 'workspace',
  sourceType: 'workspace',
  sourceId: 'e2e-workspace-1',
  label: 'E2E 测试工作区',
  documentIds: ['e2e-doc-1'],
  hasUnpreparedFiles: false,
  preparedDocumentCount: 1,
  unpreparedFileCount: 0,
  workspace: {
    workspaceId: 'e2e-workspace-1',
    rootPath: '/tmp/ncurator-e2e-workspace'
  }
}

export const E2E_SEARCH_SCOPE: SourceScopeSelection = {
  scopeType: 'workspace',
  sourceType: 'workspace',
  sourceId: 'e2e-search-workspace-1',
  label: 'E2E 搜索工作区',
  documentIds: [E2E_SEARCH_DOCUMENT_ID],
  hasUnpreparedFiles: false,
  preparedDocumentCount: 1,
  unpreparedFileCount: 0,
  workspace: {
    workspaceId: 'e2e-search-workspace-1',
    rootPath: '/tmp/ncurator-e2e-search-workspace'
  }
}

type E2EWorkspaceFixtureState = {
  workspace: WorkspaceSource | null
  nodes: WorkspaceNode[]
  mode: E2EWorkspaceFixtureMode
}

type E2ECreateImportWorkspaceNodesInput = {
  workspaceId: string
  rootPath: string
  now: number
  prepared: boolean
  filePrepareStatus?: WorkspaceNode['prepare_status']
  fileLastError?: string
}

type E2EWebSourceFixtureState = {
  items: WebSourceRecord[]
}

const createImportWorkspaceNodes = (input: E2ECreateImportWorkspaceNodesInput): WorkspaceNode[] => {
  const directoryNode: WorkspaceNode = {
    id: `${input.workspaceId}-dir-docs`,
    workspace_id: input.workspaceId,
    kind: 'directory',
    name: 'docs',
    relative_path: 'docs',
    absolute_path: `${input.rootPath}/docs`,
    exists: true,
    prepare_status: 'not_prepared',
    created_at: input.now,
    updated_at: input.now
  }
  const fileNode: WorkspaceNode = {
    id: `${input.workspaceId}-file-brief`,
    workspace_id: input.workspaceId,
    parent_id: directoryNode.id,
    kind: 'file',
    name: 'brief.txt',
    relative_path: 'docs/brief.txt',
    absolute_path: `${input.rootPath}/docs/brief.txt`,
    file_ext: '.txt',
    exists: true,
    size: 128,
    mtime_ms: input.now,
    content_hash: input.prepared ? 'e2e-import-hash' : undefined,
    prepare_status: input.prepared ? 'prepared' : input.filePrepareStatus || 'not_prepared',
    document_id: input.prepared ? E2E_IMPORT_DOCUMENT_ID : undefined,
    last_prepared_at: input.prepared ? input.now : undefined,
    last_error: input.fileLastError,
    created_at: input.now,
    updated_at: input.now
  }

  return [directoryNode, fileNode]
}

const deriveWorkspaceFixtureMode = (rootPath: string): E2EWorkspaceFixtureMode => {
  if (rootPath.includes(E2E_WORKSPACE_SCAN_ERROR_MARKER)) return 'scan_error'
  if (rootPath.includes(E2E_WORKSPACE_PREPARE_ERROR_MARKER)) return 'prepare_error'
  return 'normal'
}

const buildFixtureWebTitle = (url: string): string => {
  const parsed = new URL(url)
  return `Fixture · ${parsed.hostname}${parsed.pathname === '/' ? '' : parsed.pathname}`
}

const normalizeFixtureUrl = (rawUrl: string): { url: string; normalizedUrl: string } => {
  const parsed = new URL(rawUrl)
  parsed.hash = ''
  if (parsed.pathname.endsWith('/') && parsed.pathname !== '/') {
    parsed.pathname = parsed.pathname.slice(0, -1)
  }
  const url = parsed.toString()
  return {
    url,
    normalizedUrl: url.toLowerCase()
  }
}

const buildFixtureWebSourceSelection = (source: WebSourceRecord): SourceScopeSelection => ({
  scopeType: 'web',
  sourceType: 'web',
  sourceId: source.id,
  label: source.title || source.url,
  absolutePath: source.url,
  documentIds: source.document_id ? [source.document_id] : [],
  hasUnpreparedFiles: source.import_status !== 2,
  preparedDocumentCount: source.import_status === 2 && source.document_id ? 1 : 0,
  unpreparedFileCount: source.import_status === 2 ? 0 : 1
})

const upsertFixtureWebSource = (input: WebIngestPayload): WebSourceRecord => {
  const { url, normalizedUrl } = normalizeFixtureUrl(input.url)
  const now = Date.now()
  const existing = e2eWebSourceState.items.find((item) => item.normalized_url === normalizedUrl)

  const nextSource: WebSourceRecord = existing
    ? {
        ...existing,
        url,
        normalized_url: normalizedUrl,
        title: buildFixtureWebTitle(url),
        include_selectors: input.includeSelectors,
        exclude_selectors: input.excludeSelectors,
        import_status: 2,
        fetched_at: now,
        last_error: undefined,
        updated_at: now
      }
    : {
        id: `e2e-web-source-${e2eWebSourceState.items.length + 1}`,
        identity_kind: 'normalized_url',
        normalized_url: normalizedUrl,
        url,
        title: buildFixtureWebTitle(url),
        document_id: `e2e-web-document-${e2eWebSourceState.items.length + 1}`,
        import_status: 2,
        include_selectors: input.includeSelectors,
        exclude_selectors: input.excludeSelectors,
        fetched_at: now,
        created_at: now,
        updated_at: now
      }

  if (existing) {
    e2eWebSourceState.items = e2eWebSourceState.items.map((item) =>
      item.id === nextSource.id ? nextSource : item
    )
  } else {
    e2eWebSourceState.items = [nextSource, ...e2eWebSourceState.items]
  }

  return nextSource
}

const e2eWorkspaceState: E2EWorkspaceFixtureState = {
  workspace: null,
  nodes: [],
  mode: 'normal'
}
const e2eWebSourceState: E2EWebSourceFixtureState = {
  items: []
}

export const isE2EFixtureModeEnabled = (): boolean => process.env.NCURATOR_E2E_MODE === '1'

export const getE2EFixtureSourceScopes = (
  payload: ListSourceScopesRequest
): SourceScopeListResponse | null => {
  if (!isE2EFixtureModeEnabled()) return null

  const query = String(payload.query || '').trim()
  const importWorkspaceScope =
    e2eWorkspaceState.workspace
      ? {
          scopeType: 'workspace' as const,
          sourceType: 'workspace' as const,
          sourceId: e2eWorkspaceState.workspace.id,
          label: e2eWorkspaceState.workspace.name,
          documentIds:
            e2eWorkspaceState.workspace.status === 'prepared' ? [E2E_IMPORT_DOCUMENT_ID] : [],
          hasUnpreparedFiles: e2eWorkspaceState.workspace.status !== 'prepared',
          preparedDocumentCount: e2eWorkspaceState.workspace.status === 'prepared' ? 1 : 0,
          unpreparedFileCount: e2eWorkspaceState.workspace.status === 'prepared' ? 0 : 1,
          workspace: {
            workspaceId: e2eWorkspaceState.workspace.id,
            rootPath: e2eWorkspaceState.workspace.root_path
          }
        }
      : null
  const webScopes = e2eWebSourceState.items.map(buildFixtureWebSourceSelection)
  const allItems = [
    E2E_CHAT_WORKSPACE_SCOPE,
    E2E_SEARCH_SCOPE,
    ...webScopes,
    payload.mode === 'chat' || !importWorkspaceScope?.hasUnpreparedFiles ? importWorkspaceScope : null
  ].filter(
    (scope): scope is SourceScopeSelection => Boolean(scope)
  )
  const items = allItems.filter((scope) => {
    if (!query) return true
    return scope.label.includes(query) || scope.sourceId.includes(query)
  })

  return {
    items,
    total: items.length
  }
}

export const getE2EFixtureWorkspaceList = (): WorkspaceListResponse | null => {
  if (!isE2EFixtureModeEnabled()) return null

  const items = e2eWorkspaceState.workspace ? [e2eWorkspaceState.workspace] : []
  return {
    items,
    total: items.length
  }
}

export const createE2EFixtureWorkspace = (input: {
  rootPath: string
  name?: string
}): WorkspaceMutationResponse | null => {
  if (!isE2EFixtureModeEnabled()) return null

  const now = Date.now()
  const rootPath = String(input.rootPath || '').trim() || E2E_IMPORT_ROOT_PATH
  const workspace: WorkspaceSource = {
    id: E2E_IMPORT_WORKSPACE_ID,
    name: String(input.name || '').trim() || 'E2E 导入工作区',
    root_path: rootPath,
    status: 'not_prepared',
    last_scan_at: now,
    created_at: now,
    updated_at: now
  }
  e2eWorkspaceState.workspace = workspace
  e2eWorkspaceState.mode = deriveWorkspaceFixtureMode(rootPath)
  e2eWorkspaceState.nodes = createImportWorkspaceNodes({
    workspaceId: workspace.id,
    rootPath: workspace.root_path,
    now,
    prepared: false
  })

  return {
    success: true,
    workspace
  }
}

export const deleteE2EFixtureWorkspace = (
  workspaceId: string
): DeleteWorkspaceSourceResponse | null => {
  if (!isE2EFixtureModeEnabled()) return null
  if (!e2eWorkspaceState.workspace || e2eWorkspaceState.workspace.id !== workspaceId) {
    return {
      success: false,
      error: 'workspace not found'
    }
  }

  e2eWorkspaceState.workspace = null
  e2eWorkspaceState.nodes = []
  e2eWorkspaceState.mode = 'normal'

  return {
    success: true,
    deletedWorkspaceId: workspaceId
  }
}

export const getE2EFixtureWorkspaceNodes = (workspaceId: string): WorkspaceNodeListResponse | null => {
  if (!isE2EFixtureModeEnabled()) return null
  if (!e2eWorkspaceState.workspace || e2eWorkspaceState.workspace.id !== workspaceId) {
    return {
      items: [],
      total: 0
    }
  }

  return {
    items: e2eWorkspaceState.nodes,
    total: e2eWorkspaceState.nodes.length
  }
}

export const scanE2EFixtureWorkspace = (workspaceId: string): WorkspaceJobResponse | null => {
  if (!isE2EFixtureModeEnabled()) return null
  if (!e2eWorkspaceState.workspace || e2eWorkspaceState.workspace.id !== workspaceId) {
    return {
      success: false,
      error: 'workspace not found'
    }
  }

  const now = Date.now()
  if (e2eWorkspaceState.mode === 'scan_error') {
    e2eWorkspaceState.workspace = {
      ...e2eWorkspaceState.workspace,
      status: 'failed',
      last_scan_at: now,
      updated_at: now,
      last_error: 'E2E fixture scan failed'
    }
    return {
      success: false,
      workspaceId,
      error: 'E2E fixture scan failed'
    }
  }

  e2eWorkspaceState.workspace = {
    ...e2eWorkspaceState.workspace,
    status: 'stale',
    last_scan_at: now,
    updated_at: now
  }

  return {
    success: true,
    workspaceId,
    progress: {
      workspace_id: workspaceId,
      phase: 'scan',
      total: e2eWorkspaceState.nodes.length,
      completed: e2eWorkspaceState.nodes.length,
      added: 0,
      updated: 1,
      removed: 0,
      message: 'E2E fixture scan complete'
    }
  }
}

export const prepareE2EFixtureWorkspace = (
  workspaceId: string,
  mode: WorkspacePrepareMode
): WorkspaceJobResponse | null => {
  if (!isE2EFixtureModeEnabled()) return null
  if (!e2eWorkspaceState.workspace || e2eWorkspaceState.workspace.id !== workspaceId) {
    return {
      success: false,
      error: 'workspace not found'
    }
  }

  const now = Date.now()
  if (e2eWorkspaceState.mode === 'prepare_error') {
    e2eWorkspaceState.workspace = {
      ...e2eWorkspaceState.workspace,
      status: 'failed',
      last_scan_at: e2eWorkspaceState.workspace.last_scan_at || now,
      last_prepare_at: now,
      updated_at: now,
      last_error: 'E2E fixture prepare failed'
    }
    e2eWorkspaceState.nodes = createImportWorkspaceNodes({
      workspaceId,
      rootPath: e2eWorkspaceState.workspace.root_path,
      now,
      prepared: false,
      filePrepareStatus: 'failed',
      fileLastError: 'E2E fixture prepare failed'
    })
    return {
      success: false,
      workspaceId,
      error: 'E2E fixture prepare failed'
    }
  }

  e2eWorkspaceState.workspace = {
    ...e2eWorkspaceState.workspace,
    status: 'prepared',
    last_scan_at: e2eWorkspaceState.workspace.last_scan_at || now,
    last_prepare_at: now,
    updated_at: now,
    last_error: undefined
  }
  e2eWorkspaceState.nodes = createImportWorkspaceNodes({
    workspaceId,
    rootPath: e2eWorkspaceState.workspace.root_path,
    now,
    prepared: true
  })

  return {
    success: true,
    workspaceId,
    progress: {
      workspace_id: workspaceId,
      mode,
      phase: 'complete',
      total: 1,
      completed: 1,
      added: 1,
      updated: 1,
      removed: 0,
      failed: 0,
      message: 'E2E fixture prepare complete'
    }
  }
}

export const ingestE2EFixtureWebSource = (
  payload: WebIngestPayload
): { success: boolean; count?: number; source?: WebSourceRecord; error?: string } | null => {
  if (!isE2EFixtureModeEnabled()) return null

  try {
    const source = upsertFixtureWebSource(payload)
    return {
      success: true,
      count: 1,
      source
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

export const ingestE2EFixtureWebSources = (
  payload: WebIngestPayload[]
): { success: boolean; created?: number; error?: string } | null => {
  if (!isE2EFixtureModeEnabled()) return null

  try {
    payload.forEach((item) => {
      upsertFixtureWebSource(item)
    })
    return {
      success: true,
      created: payload.length
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

export const getE2EFixtureWebSourceList = (): WebSourceListResponse | null => {
  if (!isE2EFixtureModeEnabled()) return null
  return {
    items: e2eWebSourceState.items,
    total: e2eWebSourceState.items.length
  }
}

export const refreshE2EFixtureWebSource = (webSourceId: string): WebSourceMutationResponse | null => {
  if (!isE2EFixtureModeEnabled()) return null

  const source = e2eWebSourceState.items.find((item) => item.id === webSourceId)
  if (!source) {
    return {
      success: false,
      error: 'web source not found'
    }
  }

  const refreshed: WebSourceRecord = {
    ...source,
    title: buildFixtureWebTitle(source.url),
    import_status: 2,
    fetched_at: Date.now(),
    last_error: undefined,
    updated_at: Date.now()
  }
  e2eWebSourceState.items = e2eWebSourceState.items.map((item) =>
    item.id === refreshed.id ? refreshed : item
  )

  return {
    success: true,
    source: refreshed
  }
}

export const deleteE2EFixtureWebSource = (webSourceId: string): DeleteWebSourceResponse | null => {
  if (!isE2EFixtureModeEnabled()) return null

  const exists = e2eWebSourceState.items.some((item) => item.id === webSourceId)
  if (!exists) {
    return {
      success: false,
      error: 'web source not found'
    }
  }

  e2eWebSourceState.items = e2eWebSourceState.items.filter((item) => item.id !== webSourceId)
  return {
    success: true,
    deletedWebSourceId: webSourceId
  }
}

export const matchE2EChatScenario = (input: string): E2EChatScenario | null => {
  const normalizedInput = String(input || '').trim()

  for (const [scenario, prefix] of Object.entries(E2E_CHAT_SCENARIO_PREFIXES) as Array<
    [E2EChatScenario, string]
  >) {
    if (normalizedInput.startsWith(prefix)) {
      return scenario
    }
  }

  return null
}

export const matchE2ESearchScenario = (input: string): E2ESearchScenario | null => {
  const normalizedInput = String(input || '').trim()

  for (const [scenario, prefix] of Object.entries(E2E_SEARCH_SCENARIO_PREFIXES) as Array<
    [E2ESearchScenario, string]
  >) {
    if (normalizedInput.startsWith(prefix)) {
      return scenario
    }
  }

  return null
}

export const getE2EFixtureSearchResponse = (
  query: string,
  documentIds?: string[]
): SearchResponse | null => {
  if (!isE2EFixtureModeEnabled()) return null
  const scenario = matchE2ESearchScenario(query)
  if (!scenario) return null

  const selectedIds = Array.isArray(documentIds) ? documentIds.map((item) => String(item)) : []
  if (selectedIds.length > 0 && !selectedIds.includes(E2E_SEARCH_DOCUMENT_ID)) {
    return {
      results: [],
      tokens: ['e2e', 'search']
    }
  }

  const result: SearchResult = {
    id: 'e2e-search-result-1',
    text: 'E2E 搜索命中内容，包含范围过滤后的稳定片段。',
    document_name: 'e2e-search-result.md',
    document_id: E2E_SEARCH_DOCUMENT_ID,
    source_type: 'file',
    metadata: { page: 1 },
    created_at: Date.now(),
    document: {
      id: E2E_SEARCH_DOCUMENT_ID,
      name: 'e2e-search-result.md',
      source_type: 'file',
      file_path: '/tmp/ncurator-e2e-search-result.md',
      created_at: Date.now(),
      import_status: 2
    }
  }

  return {
    results: [result],
    tokens: ['E2E', '搜索', '命中']
  }
}

export const buildE2EChatPlan = (): AiPlanTask[] => [
  {
    id: 'task-e2e-collect-context',
    title: '收集上下文并执行检索',
    userInput: '读取输入并返回检索结果',
    status: 'ready'
  },
  {
    id: 'task-e2e-generate-artifact',
    title: '生成测试文档',
    userInput: '生成一个可展示的文件产物',
    status: 'ready'
  }
]

export const hasE2EWorkspaceBinding = (
  scopes: SourceScopeSelection[] | undefined
): boolean => {
  if (!Array.isArray(scopes)) return false
  return scopes.some((scope) => Boolean(scope.workspace?.rootPath))
}
