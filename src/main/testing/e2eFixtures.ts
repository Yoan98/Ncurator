import type {
  DeleteWorkspaceSourceResponse,
  DeleteWebSourceResponse,
  ListReferenceItemsRequest,
  SearchResponse,
  SearchResult,
  ReferenceItemListResponse,
  WebIngestPayload,
  WebSourceListResponse,
  WebSourceMutationResponse,
  WebSourceRecord,
  WorkspaceFileIndexRecord,
  WorkspaceJobResponse,
  WorkspaceListItem,
  WorkspaceMutationResponse,
  WorkspaceSource,
  WorkspaceTreeEntry,
  WorkspaceListResponse,
  WorkspaceTreeListResponse
} from '../../shared/types'
import {
  buildWebReferenceItem,
  buildWorkspaceReferenceItems,
  referenceMatchesQuery,
  shouldIncludeReferenceInSearch
} from '../services/sourceScope/selection'

export type E2EChatScenario =
  | 'chat-artifact-flow'
  | 'chat-approval'
  | 'chat-workspace'
  | 'chat-edit-apply'
  | 'chat-edit-apply-b'
  | 'chat-multi-apply'
  | 'chat-apply-revert-warning'
export type E2ESearchScenario = 'search-results'

const E2E_CHAT_SCENARIO_PREFIXES: Record<E2EChatScenario, string> = {
  'chat-artifact-flow': '[e2e:chat-artifact-flow]',
  'chat-approval': '[e2e:chat-approval]',
  'chat-workspace': '[e2e:chat-workspace]',
  'chat-edit-apply': '[e2e:chat-edit-apply]',
  'chat-edit-apply-b': '[e2e:chat-edit-apply-b]',
  'chat-multi-apply': '[e2e:chat-multi-apply]',
  'chat-apply-revert-warning': '[e2e:chat-apply-revert-warning]'
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
const E2E_WORKSPACE_SCAN_DELAY_MARKER = 'scan-delay'
const E2E_WORKSPACE_PREPARE_DELAY_MARKER = 'prepare-delay'
const E2E_WEB_REFRESH_ERROR_MARKER = 'refresh-fail'

type E2EWorkspaceFixtureMode = 'normal' | 'scan_error' | 'prepare_error'

type E2EWorkspaceFixtureState = {
  workspace: WorkspaceSource | null
  entries: WorkspaceTreeEntry[]
  records: WorkspaceFileIndexRecord[]
  mode: E2EWorkspaceFixtureMode
  scanDelayMs: number
  prepareDelayMs: number
}

type E2ECreateImportWorkspaceFixtureInput = {
  workspaceId: string
  rootPath: string
  now: number
  prepared: boolean
  fileStatus?: WorkspaceFileIndexRecord['index_status']
  fileLastError?: string
}

type E2EWebSourceFixtureState = {
  items: WebSourceRecord[]
}

const createImportWorkspaceFixture = (
  input: E2ECreateImportWorkspaceFixtureInput
): {
  entries: WorkspaceTreeEntry[]
  records: WorkspaceFileIndexRecord[]
} => {
  const directoryEntry: WorkspaceTreeEntry = {
    id: `${input.workspaceId}-dir-docs`,
    workspace_id: input.workspaceId,
    kind: 'directory',
    name: 'docs',
    relative_path: 'docs',
    absolute_path: `${input.rootPath}/docs`,
    supported_for_index: false
  }
  const fileEntry: WorkspaceTreeEntry = {
    id: `${input.workspaceId}-file-brief`,
    workspace_id: input.workspaceId,
    parent_id: directoryEntry.id,
    kind: 'file',
    name: 'brief.txt',
    relative_path: 'docs/brief.txt',
    absolute_path: `${input.rootPath}/docs/brief.txt`,
    file_ext: 'txt',
    supported_for_index: true,
    size: 128,
    mtime_ms: input.now
  }
  const fileRecord: WorkspaceFileIndexRecord = {
    id: `${input.workspaceId}-record-brief`,
    workspace_id: input.workspaceId,
    relative_path: 'docs/brief.txt',
    absolute_path: `${input.rootPath}/docs/brief.txt`,
    name: 'brief.txt',
    file_ext: 'txt',
    size: 128,
    mtime_ms: input.now,
    content_hash: input.prepared ? 'e2e-import-hash' : undefined,
    index_status: input.prepared ? 'indexed' : input.fileStatus || 'needs_index',
    document_id: input.prepared ? E2E_IMPORT_DOCUMENT_ID : undefined,
    indexed_at: input.prepared ? input.now : undefined,
    last_checked_at: input.now,
    last_error: input.fileLastError,
    created_at: input.now,
    updated_at: input.now
  }

  return {
    entries: [directoryEntry, fileEntry],
    records: [fileRecord]
  }
}

const deriveWorkspaceFixtureMode = (rootPath: string): E2EWorkspaceFixtureMode => {
  if (rootPath.includes(E2E_WORKSPACE_SCAN_ERROR_MARKER)) return 'scan_error'
  if (rootPath.includes(E2E_WORKSPACE_PREPARE_ERROR_MARKER)) return 'prepare_error'
  return 'normal'
}

const deriveWorkspaceFixtureDelayMs = (rootPath: string, phase: 'scan' | 'prepare'): number => {
  const marker =
    phase === 'scan' ? E2E_WORKSPACE_SCAN_DELAY_MARKER : E2E_WORKSPACE_PREPARE_DELAY_MARKER
  return rootPath.includes(marker) ? 1200 : 0
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

const upsertFixtureWebSource = (input: WebIngestPayload): WebSourceRecord => {
  const { url, normalizedUrl } = normalizeFixtureUrl(input.url)
  const now = Date.now()
  const workspaceId = String(input.workspaceId || '').trim()
  const existing = e2eWebSourceState.items.find(
    (item) => item.workspace_id === workspaceId && item.normalized_url === normalizedUrl
  )

  const nextSource: WebSourceRecord = existing
    ? {
        ...existing,
        workspace_id: workspaceId,
        url,
        normalized_url: normalizedUrl,
        title: buildFixtureWebTitle(url),
        include_selectors: input.includeSelectors,
        exclude_selectors: input.excludeSelectors,
        index_status: 'indexed',
        fetched_at: now,
        last_crawled_at: now,
        last_indexed_at: now,
        last_error: undefined,
        updated_at: now
      }
    : {
        id: `e2e-web-source-${e2eWebSourceState.items.length + 1}`,
        workspace_id: workspaceId,
        identity_kind: 'normalized_url',
        normalized_url: normalizedUrl,
        url,
        title: buildFixtureWebTitle(url),
        document_id: `e2e-web-document-${e2eWebSourceState.items.length + 1}`,
        index_status: 'indexed',
        include_selectors: input.includeSelectors,
        exclude_selectors: input.excludeSelectors,
        fetched_at: now,
        last_crawled_at: now,
        last_indexed_at: now,
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
  entries: [],
  records: [],
  mode: 'normal',
  scanDelayMs: 0,
  prepareDelayMs: 0
}
const e2eWebSourceState: E2EWebSourceFixtureState = {
  items: []
}

export const isE2EFixtureModeEnabled = (): boolean => process.env.NCURATOR_E2E_MODE === '1'

export const getE2EFixtureReferenceItems = (
  payload: ListReferenceItemsRequest
): ReferenceItemListResponse | null => {
  if (!isE2EFixtureModeEnabled()) return null

  const workspaceId = String(payload.workspaceId || '').trim()
  const referenceKindFilters =
    Array.isArray(payload.referenceKinds) && payload.referenceKinds.length > 0
      ? new Set(payload.referenceKinds.map((referenceKind) => String(referenceKind || '').trim()))
      : null
  const fixtureWorkspaceReferences =
    workspaceId && e2eWorkspaceState.workspace && e2eWorkspaceState.workspace.id === workspaceId
      ? buildWorkspaceReferenceItems({
          workspace: e2eWorkspaceState.workspace,
          entries: e2eWorkspaceState.entries,
          records: e2eWorkspaceState.records
        })
      : []
  const webReferences = e2eWebSourceState.items
    .filter((item) => item.workspace_id === workspaceId)
    .map(buildWebReferenceItem)
  const allItems = [...fixtureWorkspaceReferences, ...webReferences]
  const items = allItems.filter((reference) => {
    if (referenceKindFilters && !referenceKindFilters.has(reference.kind)) return false
    if (!referenceMatchesQuery(reference, payload.query)) return false
    if (payload.mode === 'search' && !shouldIncludeReferenceInSearch(reference)) return false
    return true
  })

  return {
    items,
    total: items.length
  }
}

export const getE2EFixtureWorkspaceList = (): WorkspaceListResponse | null => {
  if (!isE2EFixtureModeEnabled()) return null

  const items: WorkspaceListItem[] = e2eWorkspaceState.workspace
    ? [
        {
          ...e2eWorkspaceState.workspace,
          file_count: e2eWorkspaceState.records.length,
          web_count: e2eWebSourceState.items.filter(
            (item) => item.workspace_id === e2eWorkspaceState.workspace?.id
          ).length
        }
      ]
    : []
  return {
    items,
    total: items.length
  }
}

export const getE2EFixtureWorkspaceTree = (
  workspaceId: string,
  includeUnsupported = false
): WorkspaceTreeListResponse | null => {
  if (!isE2EFixtureModeEnabled()) return null
  if (!e2eWorkspaceState.workspace || e2eWorkspaceState.workspace.id !== workspaceId) {
    return {
      items: [],
      total: 0,
      summary: {
        file_count: 0,
        indexed_file_count: 0,
        needs_index_count: 0,
        failed_file_count: 0
      }
    }
  }

  const recordMap = new Map(
    e2eWorkspaceState.records.map((record) => [record.relative_path, record] as const)
  )
  const items = e2eWorkspaceState.entries
    .map((entry) => {
      if (entry.kind !== 'file' || !entry.supported_for_index) return entry
      const record = recordMap.get(entry.relative_path)
      if (!record) return entry
      return {
        ...entry,
        index_status: record.index_status,
        document_id: record.document_id,
        indexed_at: record.indexed_at,
        last_error: record.last_error
      }
    })
    .filter((entry) => includeUnsupported || entry.kind === 'directory' || entry.supported_for_index)

  const summary = {
    file_count: e2eWorkspaceState.records.length,
    indexed_file_count: e2eWorkspaceState.records.filter((item) => item.index_status === 'indexed')
      .length,
    needs_index_count: e2eWorkspaceState.records.filter(
      (item) => item.index_status === 'needs_index'
    ).length,
    failed_file_count: e2eWorkspaceState.records.filter((item) => item.index_status === 'failed')
      .length
  }

  return {
    items,
    total: items.length,
    summary
  }
}

export const createE2EFixtureWorkspace = (input: {
  rootPath: string
  name?: string
}): WorkspaceMutationResponse | null => {
  if (!isE2EFixtureModeEnabled()) return null

  const now = Date.now()
  const rootPath = String(input.rootPath || '').trim()
  const workspace: WorkspaceSource = {
    id: E2E_IMPORT_WORKSPACE_ID,
    name: String(input.name || '').trim() || 'E2E 导入工作区',
    root_path: rootPath || undefined,
    created_at: now,
    updated_at: now
  }
  e2eWorkspaceState.workspace = workspace
  e2eWorkspaceState.mode = deriveWorkspaceFixtureMode(rootPath || E2E_IMPORT_ROOT_PATH)
  e2eWorkspaceState.scanDelayMs = deriveWorkspaceFixtureDelayMs(rootPath || E2E_IMPORT_ROOT_PATH, 'scan')
  e2eWorkspaceState.prepareDelayMs = deriveWorkspaceFixtureDelayMs(rootPath || E2E_IMPORT_ROOT_PATH, 'prepare')
  if (workspace.root_path) {
    const fixture = createImportWorkspaceFixture({
      workspaceId: workspace.id,
      rootPath: workspace.root_path,
      now,
      prepared: false
    })
    e2eWorkspaceState.entries = fixture.entries
    e2eWorkspaceState.records = fixture.records
  } else {
    e2eWorkspaceState.entries = []
    e2eWorkspaceState.records = []
  }

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
  e2eWorkspaceState.entries = []
  e2eWorkspaceState.records = []
  e2eWorkspaceState.mode = 'normal'
  e2eWorkspaceState.scanDelayMs = 0
  e2eWorkspaceState.prepareDelayMs = 0
  e2eWebSourceState.items = e2eWebSourceState.items.filter((item) => item.workspace_id !== workspaceId)

  return {
    success: true,
    deletedWorkspaceId: workspaceId
  }
}

export const getE2EFixtureWorkspaceDelayMs = (phase: 'scan' | 'prepare'): number => {
  if (!isE2EFixtureModeEnabled()) return 0
  return phase === 'scan' ? e2eWorkspaceState.scanDelayMs : e2eWorkspaceState.prepareDelayMs
}

export const setE2EFixtureWorkspaceRootPath = (
  workspaceId: string,
  rootPath: string
): WorkspaceMutationResponse | null => {
  if (!isE2EFixtureModeEnabled()) return null
  if (!e2eWorkspaceState.workspace || e2eWorkspaceState.workspace.id !== workspaceId) {
    return {
      success: false,
      error: 'workspace not found'
    }
  }

  const now = Date.now()
  const normalizedRootPath = String(rootPath || '').trim()
  e2eWorkspaceState.workspace = {
    ...e2eWorkspaceState.workspace,
    root_path: normalizedRootPath || undefined,
    updated_at: now
  }
  e2eWorkspaceState.mode = deriveWorkspaceFixtureMode(normalizedRootPath || E2E_IMPORT_ROOT_PATH)
  e2eWorkspaceState.scanDelayMs = deriveWorkspaceFixtureDelayMs(
    normalizedRootPath || E2E_IMPORT_ROOT_PATH,
    'scan'
  )
  e2eWorkspaceState.prepareDelayMs = deriveWorkspaceFixtureDelayMs(
    normalizedRootPath || E2E_IMPORT_ROOT_PATH,
    'prepare'
  )

  if (normalizedRootPath) {
    const fixture = createImportWorkspaceFixture({
      workspaceId,
      rootPath: normalizedRootPath,
      now,
      prepared: false
    })
    e2eWorkspaceState.entries = fixture.entries
    e2eWorkspaceState.records = fixture.records
  } else {
    e2eWorkspaceState.entries = []
    e2eWorkspaceState.records = []
  }

  return {
    success: true,
    workspace: e2eWorkspaceState.workspace
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
    return {
      success: false,
      workspaceId,
      error: 'E2E fixture scan failed'
    }
  }
  if (e2eWorkspaceState.workspace.root_path) {
    const fixture = createImportWorkspaceFixture({
      workspaceId,
      rootPath: e2eWorkspaceState.workspace.root_path,
      now,
      prepared: false
    })
    e2eWorkspaceState.entries = fixture.entries
    e2eWorkspaceState.records = fixture.records.map((record) => ({
      ...record,
      index_status: 'needs_index',
      updated_at: now,
      last_checked_at: now
    }))
  }

  return {
    success: true,
    workspaceId,
    progress: {
      workspace_id: workspaceId,
      phase: 'scan',
      total: e2eWorkspaceState.records.length,
      completed: e2eWorkspaceState.records.length,
      added: 0,
      updated: 1,
      removed: 0,
      message: 'E2E fixture scan complete'
    }
  }
}

export const prepareE2EFixtureWorkspace = (workspaceId: string): WorkspaceJobResponse | null => {
  if (!isE2EFixtureModeEnabled()) return null
  if (!e2eWorkspaceState.workspace || e2eWorkspaceState.workspace.id !== workspaceId) {
    return {
      success: false,
      error: 'workspace not found'
    }
  }

  const now = Date.now()
  if (e2eWorkspaceState.mode === 'prepare_error') {
    const fixture = createImportWorkspaceFixture({
      workspaceId,
      rootPath: e2eWorkspaceState.workspace.root_path || E2E_IMPORT_ROOT_PATH,
      now,
      prepared: false,
      fileStatus: 'failed',
      fileLastError: 'E2E fixture prepare failed'
    })
    e2eWorkspaceState.entries = fixture.entries
    e2eWorkspaceState.records = fixture.records
    return {
      success: false,
      workspaceId,
      error: 'E2E fixture prepare failed'
    }
  }

  const fixture = createImportWorkspaceFixture({
    workspaceId,
    rootPath: e2eWorkspaceState.workspace.root_path || E2E_IMPORT_ROOT_PATH,
    now,
    prepared: true
  })
  e2eWorkspaceState.entries = fixture.entries
  e2eWorkspaceState.records = fixture.records

  return {
    success: true,
    workspaceId,
    progress: {
      workspace_id: workspaceId,
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

export const getE2EFixtureWebSourceList = (workspaceId: string): WebSourceListResponse | null => {
  if (!isE2EFixtureModeEnabled()) return null
  const items = e2eWebSourceState.items.filter((item) => item.workspace_id === workspaceId)
  const summary = {
    web_count: items.length,
    needs_index_count: items.filter((item) => item.index_status === 'needs_index').length,
    failed_count: items.filter(
      (item) => item.index_status === 'crawl_failed' || item.index_status === 'index_failed'
    ).length
  }
  return {
    items,
    total: items.length,
    summary
  }
}

export const scanE2EFixtureWebSources = (workspaceId: string): WorkspaceJobResponse | null => {
  if (!isE2EFixtureModeEnabled()) return null

  const items = e2eWebSourceState.items.filter((item) => item.workspace_id === workspaceId)
  if (items.length === 0) {
    return {
      success: true,
      workspaceId,
      progress: {
        workspace_id: workspaceId,
        phase: 'inspect',
        total: 0,
        completed: 0,
        failed: 0,
        message: 'E2E fixture web scan complete'
      }
    }
  }

  const now = Date.now()
  e2eWebSourceState.items = e2eWebSourceState.items.map((item) => {
    if (item.workspace_id !== workspaceId) return item
    return {
      ...item,
      index_status: item.index_status === 'indexed' ? 'needs_index' : item.index_status,
      last_checked_at: now,
      updated_at: now
    }
  })

  return {
    success: true,
    workspaceId,
    progress: {
      workspace_id: workspaceId,
      phase: 'inspect',
      total: items.length,
      completed: items.length,
      failed: 0,
      message: 'E2E fixture web scan complete'
    }
  }
}

export const prepareE2EFixtureWebSources = (workspaceId: string): WorkspaceJobResponse | null => {
  if (!isE2EFixtureModeEnabled()) return null

  const targets = e2eWebSourceState.items.filter(
    (item) =>
      item.workspace_id === workspaceId &&
      (item.index_status === 'needs_index' ||
        item.index_status === 'crawl_failed' ||
        item.index_status === 'index_failed')
  )
  const startedAt = Date.now()
  let failed = 0

  e2eWebSourceState.items = e2eWebSourceState.items.map((item) => {
    if (item.workspace_id !== workspaceId) return item
    const target = targets.find((candidate) => candidate.id === item.id)
    if (!target) return item

    if (item.url.includes(E2E_WEB_REFRESH_ERROR_MARKER)) {
      failed += 1
      return {
        ...item,
        index_status: 'crawl_failed',
        last_checked_at: startedAt,
        last_error: 'E2E fixture web refresh failed',
        updated_at: startedAt
      }
    }

    return {
      ...item,
      title: buildFixtureWebTitle(item.url),
      document_id: item.document_id || `e2e-web-document-${item.id}`,
      index_status: 'indexed',
      fetched_at: startedAt,
      last_checked_at: startedAt,
      last_crawled_at: startedAt,
      last_indexed_at: startedAt,
      last_error: undefined,
      updated_at: startedAt
    }
  })

  return {
    success: true,
    workspaceId,
    progress: {
      workspace_id: workspaceId,
      phase: 'index',
      total: targets.length,
      completed: targets.length - failed,
      failed,
      message: 'E2E fixture web prepare complete'
    }
  }
}

export const refreshE2EFixtureWebSource = (
  workspaceId: string,
  webSourceId: string
): WebSourceMutationResponse | null => {
  if (!isE2EFixtureModeEnabled()) return null

  const source = e2eWebSourceState.items.find(
    (item) => item.workspace_id === workspaceId && item.id === webSourceId
  )
  if (!source) {
    return {
      success: false,
      error: 'web source not found'
    }
  }

  if (source.url.includes(E2E_WEB_REFRESH_ERROR_MARKER)) {
    const failed: WebSourceRecord = {
      ...source,
      index_status: 'crawl_failed',
      last_error: 'E2E fixture web refresh failed',
      updated_at: Date.now()
    }
    e2eWebSourceState.items = e2eWebSourceState.items.map((item) =>
      item.id === failed.id ? failed : item
    )
    return {
      success: false,
      error: 'E2E fixture web refresh failed'
    }
  }

  const refreshed: WebSourceRecord = {
    ...source,
    title: buildFixtureWebTitle(source.url),
    index_status: 'indexed',
    fetched_at: Date.now(),
    last_crawled_at: Date.now(),
    last_indexed_at: Date.now(),
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

export const deleteE2EFixtureWebSource = (
  workspaceId: string,
  webSourceId: string
): DeleteWebSourceResponse | null => {
  if (!isE2EFixtureModeEnabled()) return null

  const exists = e2eWebSourceState.items.some(
    (item) => item.workspace_id === workspaceId && item.id === webSourceId
  )
  if (!exists) {
    return {
      success: false,
      error: 'web source not found'
    }
  }

  e2eWebSourceState.items = e2eWebSourceState.items.filter(
    (item) => !(item.workspace_id === workspaceId && item.id === webSourceId)
  )
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

  const fileResult: SearchResult = {
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

  const webResult: SearchResult = {
    id: 'e2e-search-result-web-1',
    text: 'E2E 网页搜索命中内容，用于验证外部打开规则。',
    document_name: 'fixture-web-result',
    document_id: 'e2e-search-web-doc-1',
    source_type: 'web',
    created_at: Date.now(),
    document: {
      id: 'e2e-search-web-doc-1',
      name: 'fixture-web-result',
      source_type: 'web',
      file_path: 'https://example.com/e2e-search-result',
      created_at: Date.now(),
      import_status: 2
    }
  }

  return {
    results: [fileResult, webResult],
    tokens: ['E2E', '搜索', '命中']
  }
}
