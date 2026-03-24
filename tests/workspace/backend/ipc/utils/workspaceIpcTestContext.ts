import path from 'node:path'
import { vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import type {
  CreateWorkspaceSourceRequest,
  DeleteWebSourceResponse,
  DeleteWorkspaceSourceResponse,
  DocumentRecord,
  ListSourceScopesRequest,
  ListWorkspaceNodesRequest,
  PrepareWorkspaceRequest,
  RefreshWebSourceRequest,
  SourceScopeListResponse,
  WebSourceListResponse,
  WebSourceMutationResponse,
  WebSourceRecord,
  WorkspaceJobResponse,
  WorkspaceListResponse,
  WorkspaceMutationResponse,
  WorkspaceNode,
  WorkspaceNodeListResponse,
  WorkspaceSource
} from '../../../../../src/shared/types'

type IpcInvokeArg = string | number | boolean | null | object
type IpcInvokeResult = string | number | boolean | null | object
type RegisteredHandler = (
  event: IpcMainInvokeEvent,
  ...args: readonly IpcInvokeArg[]
) => Promise<IpcInvokeResult>

type DocumentChunkRecord = {
  id: string
  document_id: string
}

const cloneWorkspace = (workspace: WorkspaceSource): WorkspaceSource => ({
  ...workspace
})

const cloneWorkspaceNode = (node: WorkspaceNode): WorkspaceNode => ({
  ...node
})

const cloneDocument = (document: DocumentRecord): DocumentRecord => ({
  ...document
})

const cloneWebSource = (source: WebSourceRecord): WebSourceRecord => ({
  ...source,
  include_selectors: source.include_selectors ? [...source.include_selectors] : undefined,
  exclude_selectors: source.exclude_selectors ? [...source.exclude_selectors] : undefined
})

class InMemoryWorkspaceStore {
  private readonly workspaces = new Map<string, WorkspaceSource>()
  private readonly nodesByWorkspaceId = new Map<string, WorkspaceNode[]>()

  public async saveWorkspace(workspace: WorkspaceSource): Promise<void> {
    this.workspaces.set(workspace.id, cloneWorkspace(workspace))
  }

  public async listWorkspaces(): Promise<WorkspaceSource[]> {
    return Array.from(this.workspaces.values())
      .map(cloneWorkspace)
      .sort((left, right) => left.created_at - right.created_at)
  }

  public async getWorkspaceById(id: string): Promise<WorkspaceSource | null> {
    const matched = this.workspaces.get(id)
    return matched ? cloneWorkspace(matched) : null
  }

  public async replaceWorkspaceNodes(workspaceId: string, nodes: WorkspaceNode[]): Promise<void> {
    this.nodesByWorkspaceId.set(workspaceId, nodes.map(cloneWorkspaceNode))
  }

  public async listWorkspaceNodes(input: {
    workspaceId: string
    parentId?: string
    kind?: WorkspaceNode['kind']
  }): Promise<WorkspaceNode[]> {
    return (this.nodesByWorkspaceId.get(input.workspaceId) || [])
      .filter((node) => {
        if (input.parentId && node.parent_id !== input.parentId) return false
        if (input.kind && node.kind !== input.kind) return false
        return true
      })
      .map(cloneWorkspaceNode)
      .sort((left, right) => left.relative_path.localeCompare(right.relative_path))
  }

  public async deleteWorkspace(id: string): Promise<void> {
    this.workspaces.delete(id)
    this.nodesByWorkspaceId.delete(id)
  }

  public async updateWorkspace(
    id: string,
    values: Partial<
      Pick<
        WorkspaceSource,
        'name' | 'root_path' | 'status' | 'last_scan_at' | 'last_prepare_at' | 'last_error' | 'updated_at'
      >
    >
  ): Promise<void> {
    const existing = this.workspaces.get(id)
    if (!existing) return
    this.workspaces.set(id, {
      ...existing,
      ...values
    })
  }

  public async updateWorkspaceNode(
    id: string,
    values: Partial<
      Pick<
        WorkspaceNode,
        'document_id' | 'content_hash' | 'prepare_status' | 'last_prepared_at' | 'last_error' | 'updated_at'
      >
    >
  ): Promise<void> {
    for (const [workspaceId, nodes] of this.nodesByWorkspaceId.entries()) {
      const matched = nodes.find((node) => node.id === id)
      if (!matched) continue
      this.nodesByWorkspaceId.set(
        workspaceId,
        nodes.map((node) =>
          node.id === id
            ? {
                ...node,
                ...values
              }
            : node
        )
      )
      return
    }
  }
}

class InMemoryDocumentsStore {
  private readonly documents = new Map<string, DocumentRecord>()
  private readonly chunks: DocumentChunkRecord[] = []

  public async listDocuments(input: {
    page: number
    pageSize: number
  }): Promise<{ items: DocumentRecord[]; total: number }> {
    const items = Array.from(this.documents.values())
      .map(cloneDocument)
      .sort((left, right) => left.created_at - right.created_at)
    const start = Math.max(0, (input.page - 1) * input.pageSize)
    return {
      items: items.slice(start, start + input.pageSize),
      total: items.length
    }
  }

  public async getDocumentById(id: string): Promise<DocumentRecord | null> {
    const matched = this.documents.get(id)
    return matched ? cloneDocument(matched) : null
  }

  public async addDocument(document: DocumentRecord): Promise<void> {
    this.documents.set(document.id, cloneDocument(document))
  }

  public async updateDocumentById(
    id: string,
    values: Partial<
      Pick<
        DocumentRecord,
        | 'name'
        | 'file_path'
        | 'source_type'
        | 'source_id'
        | 'source_url'
        | 'source_title'
        | 'normalized_source_url'
        | 'fetched_at'
        | 'updated_at'
        | 'last_error'
      >
    >
  ): Promise<void> {
    const existing = this.documents.get(id)
    if (!existing) return
    this.documents.set(id, {
      ...existing,
      ...values
    })
  }

  public async updateDocumentImportStatus(
    id: string,
    importStatus: DocumentRecord['import_status']
  ): Promise<void> {
    const existing = this.documents.get(id)
    if (!existing) return
    this.documents.set(id, {
      ...existing,
      import_status: importStatus
    })
  }

  public async deleteChunksByDocumentIds(documentIds: string[]): Promise<void> {
    const deleteSet = new Set(documentIds)
    let index = this.chunks.length - 1
    while (index >= 0) {
      if (deleteSet.has(this.chunks[index].document_id)) {
        this.chunks.splice(index, 1)
      }
      index -= 1
    }
  }

  public async addChunks(input: {
    vectors: Float32Array[]
    chunks: Array<{
      id: string
      document_id: string
      document_name: string
      source_type: string
      text: string
      metadata: { page: number }
    }>
  }): Promise<void> {
    void input.vectors
    this.chunks.push(
      ...input.chunks.map((chunk) => ({
        id: chunk.id,
        document_id: chunk.document_id
      }))
    )
  }

  public async deleteDocumentsByIds(documentIds: string[]): Promise<void> {
    for (const documentId of documentIds) {
      this.documents.delete(documentId)
    }
    await this.deleteChunksByDocumentIds(documentIds)
  }
}

class InMemoryWebSourceStore {
  private readonly sources = new Map<string, WebSourceRecord>()

  public async saveWebSource(source: WebSourceRecord): Promise<void> {
    this.sources.set(source.id, cloneWebSource(source))
  }

  public async listWebSources(): Promise<WebSourceRecord[]> {
    return Array.from(this.sources.values())
      .map(cloneWebSource)
      .sort((left, right) => left.created_at - right.created_at)
  }

  public async getWebSourceById(id: string): Promise<WebSourceRecord | null> {
    const matched = this.sources.get(id)
    return matched ? cloneWebSource(matched) : null
  }

  public async getWebSourceByNormalizedUrl(normalizedUrl: string): Promise<WebSourceRecord | null> {
    for (const source of this.sources.values()) {
      if (source.normalized_url === normalizedUrl) {
        return cloneWebSource(source)
      }
    }
    return null
  }

  public async updateWebSource(
    id: string,
    values: Partial<
      Pick<
        WebSourceRecord,
        | 'url'
        | 'title'
        | 'document_id'
        | 'import_status'
        | 'include_selectors'
        | 'exclude_selectors'
        | 'fetched_at'
        | 'last_error'
        | 'updated_at'
      >
    >
  ): Promise<void> {
    const existing = this.sources.get(id)
    if (!existing) return
    this.sources.set(id, {
      ...existing,
      ...values,
      include_selectors: values.include_selectors ? [...values.include_selectors] : existing.include_selectors,
      exclude_selectors: values.exclude_selectors ? [...values.exclude_selectors] : existing.exclude_selectors
    })
  }

  public async deleteWebSource(id: string): Promise<void> {
    this.sources.delete(id)
  }
}

const buildSplitDocs = (title: string, pageContent: string) => ({
  title,
  bigSplitDocs: [
    {
      pageContent,
      metadata: {
        loc: {
          pageNumber: 1
        }
      }
    }
  ],
  miniSplitDocs: [] as Array<{
    pageContent: string
    metadata: {
      loc?: {
        pageNumber?: number
      }
    }
  }>
})

export type WorkspaceIpcTestContext = {
  workspaceStore: InMemoryWorkspaceStore
  documentsStore: InMemoryDocumentsStore
  webSourceStore: InMemoryWebSourceStore
  senderMessages: Array<{ channel: string; payloads: IpcInvokeArg[] }>
  workspaceList: () => Promise<WorkspaceListResponse>
  workspaceCreate: (payload: CreateWorkspaceSourceRequest) => Promise<WorkspaceMutationResponse>
  workspaceDelete: (workspaceId: string) => Promise<DeleteWorkspaceSourceResponse>
  workspaceNodes: (payload: ListWorkspaceNodesRequest) => Promise<WorkspaceNodeListResponse>
  workspaceScan: (payload: { workspaceId: string }) => Promise<WorkspaceJobResponse>
  workspacePrepare: (payload: PrepareWorkspaceRequest) => Promise<WorkspaceJobResponse>
  webSourceList: () => Promise<WebSourceListResponse>
  webSourceRefresh: (payload: RefreshWebSourceRequest) => Promise<WebSourceMutationResponse>
  webSourceDelete: (webSourceId: string) => Promise<DeleteWebSourceResponse>
  sourceScopeList: (payload: ListSourceScopesRequest) => Promise<SourceScopeListResponse>
}

export const createWorkspaceIpcTestContext = async (input: {
  userDataRoot: string
}): Promise<WorkspaceIpcTestContext> => {
  vi.resetModules()

  const registeredHandlers = new Map<string, RegisteredHandler>()
  const senderMessages: Array<{ channel: string; payloads: IpcInvokeArg[] }> = []

  vi.doMock('electron', () => ({
    app: {
      getPath: (name: string) =>
        name === 'userData' ? path.join(input.userDataRoot, 'electron-user-data') : input.userDataRoot
    },
    ipcMain: {
      handle: (name: string, handler: RegisteredHandler) => {
        registeredHandlers.set(name, handler)
      },
      on: vi.fn()
    },
    shell: {
      showItemInFolder: vi.fn(),
      openExternal: vi.fn()
    }
  }))

  const [{ registerHandlers }, { StorageService }, { IngestionService }, { EmbeddingService }, { ModelService }] =
    await Promise.all([
      import('../../../../../src/main/ipc/handlers'),
      import('../../../../../src/main/services/storage/StorageService'),
      import('../../../../../src/main/services/ingestion/loader'),
      import('../../../../../src/main/services/vector/EmbeddingService'),
      import('../../../../../src/main/services/model/ModelService')
    ])

  const workspaceStore = new InMemoryWorkspaceStore()
  const documentsStore = new InMemoryDocumentsStore()
  const webSourceStore = new InMemoryWebSourceStore()

  const storageService = Object.create(StorageService.prototype) as StorageService
  Object.assign(storageService, {
    documents: documentsStore,
    webSource: webSourceStore,
    workspace: workspaceStore,
    chat: {},
    draftReview: {},
    llm: {},
    aiRuntimeSettings: {},
    getLegacyLocalImportMigrationStatus: () => null
  })

  const ingestionService = Object.create(IngestionService.prototype) as IngestionService
  Object.assign(ingestionService, {
    processFile: async (filePath: string) =>
      buildSplitDocs(path.basename(filePath), `prepared:${path.basename(filePath)}`),
    processWebUrl: async (payload: {
      url: string
      includeSelectors?: string[]
      excludeSelectors?: string[]
    }) => {
      void payload.includeSelectors
      void payload.excludeSelectors
      return buildSplitDocs(`Fetched ${payload.url}`, `web:${payload.url}`)
    }
  })

  const embeddingService = Object.create(EmbeddingService.prototype) as EmbeddingService
  Object.assign(embeddingService, {
    embed: async (_value: string) => ({
      data: new Float32Array(768),
      dims: [1, 768] as [number, number]
    })
  })

  const modelService = Object.create(ModelService.prototype) as ModelService

  registerHandlers({
    ingestionService,
    embeddingService,
    storageService,
    modelService
  })

  const buildEvent = (): IpcMainInvokeEvent =>
    ({
      sender: {
        send: (channel: string, ...payloads: IpcInvokeArg[]) => {
          senderMessages.push({
            channel,
            payloads: [...payloads]
          })
        }
      }
    }) as IpcMainInvokeEvent

  const invoke = async <TResult extends IpcInvokeResult>(
    name: string,
    ...args: IpcInvokeArg[]
  ): Promise<TResult> => {
    const handler = registeredHandlers.get(name)
    if (!handler) {
      throw new Error(`missing ipc handler: ${name}`)
    }
    return (await handler(buildEvent(), ...args)) as TResult
  }

  return {
    workspaceStore,
    documentsStore,
    webSourceStore,
    senderMessages,
    workspaceList: () => invoke<WorkspaceListResponse>('workspace-list'),
    workspaceCreate: (payload) => invoke<WorkspaceMutationResponse>('workspace-create', payload),
    workspaceDelete: (workspaceId) => invoke<DeleteWorkspaceSourceResponse>('workspace-delete', workspaceId),
    workspaceNodes: (payload) => invoke<WorkspaceNodeListResponse>('workspace-nodes', payload),
    workspaceScan: (payload) => invoke<WorkspaceJobResponse>('workspace-scan', payload),
    workspacePrepare: (payload) => invoke<WorkspaceJobResponse>('workspace-prepare', payload),
    webSourceList: () => invoke<WebSourceListResponse>('web-source-list'),
    webSourceRefresh: (payload) => invoke<WebSourceMutationResponse>('web-source-refresh', payload),
    webSourceDelete: (webSourceId) =>
      invoke<DeleteWebSourceResponse>('web-source-delete', webSourceId),
    sourceScopeList: (payload) => invoke<SourceScopeListResponse>('source-scope-list', payload)
  }
}
