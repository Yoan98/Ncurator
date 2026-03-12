import type {
  AiPlanTask,
  ListSourceScopesRequest,
  SearchResponse,
  SearchResult,
  SourceScopeListResponse,
  SourceScopeSelection,
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
}

const createImportWorkspaceNodes = (input: {
  workspaceId: string
  rootPath: string
  now: number
  prepared: boolean
}): WorkspaceNode[] => {
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
    prepare_status: input.prepared ? 'prepared' : 'not_prepared',
    document_id: input.prepared ? E2E_IMPORT_DOCUMENT_ID : undefined,
    last_prepared_at: input.prepared ? input.now : undefined,
    created_at: input.now,
    updated_at: input.now
  }

  return [directoryNode, fileNode]
}

const e2eWorkspaceState: E2EWorkspaceFixtureState = {
  workspace: null,
  nodes: []
}

export const isE2EFixtureModeEnabled = (): boolean => process.env.NCURATOR_E2E_MODE === '1'

export const getE2EFixtureSourceScopes = (
  payload: ListSourceScopesRequest
): SourceScopeListResponse | null => {
  if (!isE2EFixtureModeEnabled()) return null

  const query = String(payload.query || '').trim()
  const importWorkspaceScope =
    e2eWorkspaceState.workspace?.status === 'prepared'
      ? {
          scopeType: 'workspace' as const,
          sourceType: 'workspace' as const,
          sourceId: e2eWorkspaceState.workspace.id,
          label: e2eWorkspaceState.workspace.name,
          documentIds: [E2E_IMPORT_DOCUMENT_ID],
          hasUnpreparedFiles: false,
          preparedDocumentCount: 1,
          unpreparedFileCount: 0,
          workspace: {
            workspaceId: e2eWorkspaceState.workspace.id,
            rootPath: e2eWorkspaceState.workspace.root_path
          }
        }
      : null
  const allItems = [E2E_CHAT_WORKSPACE_SCOPE, E2E_SEARCH_SCOPE, importWorkspaceScope].filter(
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
  const workspace: WorkspaceSource = {
    id: E2E_IMPORT_WORKSPACE_ID,
    name: String(input.name || '').trim() || 'E2E 导入工作区',
    root_path: String(input.rootPath || '').trim() || E2E_IMPORT_ROOT_PATH,
    status: 'not_prepared',
    last_scan_at: now,
    created_at: now,
    updated_at: now
  }
  e2eWorkspaceState.workspace = workspace
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
    objective: '读取输入并返回检索结果',
    status: 'pending',
    attempts: 0
  },
  {
    id: 'task-e2e-generate-artifact',
    title: '生成测试文档',
    objective: '生成一个可展示的文件产物',
    status: 'pending',
    attempts: 0
  }
]

export const hasE2EWorkspaceBinding = (
  scopes: SourceScopeSelection[] | undefined
): boolean => {
  if (!Array.isArray(scopes)) return false
  return scopes.some((scope) => Boolean(scope.workspace?.rootPath))
}
