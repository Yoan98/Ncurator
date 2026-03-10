import { ipcMain, shell } from 'electron'
import { IngestionService } from '../services/ingestion/loader'
import { EmbeddingService } from '../services/vector/EmbeddingService'
import { StorageService } from '../services/storage/StorageService'
import { ModelService } from '../services/model/ModelService'
import { AiRunService } from '../services/ai/AiRunService'
import { updateSessionMemoryAfterRun } from '../services/ai/memory'
import { releaseDocxRunSession } from '../services/ai/tools/docx/worker/docxWorkerClient'
import {
  buildWebScopeSelection,
  buildWorkspaceScopeSelections,
  collectScopeDocumentIds,
  collectUnpreparedFileCount,
  collectPreparedDocumentIds,
  getWorkspaceScopeKey,
  scopeMatchesQuery,
  shouldIncludeScopeInSearch
} from '../services/sourceScope/selection'
import { validateSelectedScopesForRun } from '../services/sourceScope/validation'
import { WorkspaceSourceService } from '../services/workspace/WorkspaceSourceService'
import { WebSourceService } from '../services/web/WebSourceService'
import { v4 as uuidv4 } from 'uuid'
import type {
  SearchResult,
  DocumentListResponse,
  ChunkListResponse,
  ChatSession,
  ChatMessage,
  LLMConfig,
  AiRunEvent,
  AiRunStartRequest,
  AiRunStartResponse,
  AiRunCancelResponse,
  AiRunApprovalDecisionRequest,
  AiRunApprovalDecisionResponse,
  CreateWorkspaceSourceRequest,
  DeleteWorkspaceSourceResponse,
  ListSourceScopesRequest,
  ListWorkspaceNodesRequest,
  SourceScopeListResponse,
  SourceScopeSelection,
  WebSourceListResponse,
  WebSourceMutationResponse,
  DeleteWebSourceResponse,
  WebSourceRecord,
  WorkspaceJobResponse,
  WorkspaceMutationResponse,
  WorkspaceNode,
  WorkspaceNodeListResponse,
  WorkspaceSource,
  WorkspaceListResponse
} from '../types/store'
import path from 'path'
import fs from 'fs'
import { WEB_INGEST_CONCURRENCY } from '../utils/constant'
import { Jieba } from '@node-rs/jieba'
import { dict } from '@node-rs/jieba/dict'
import { normalizeForIpc } from '../utils/serialization'

const jieba = Jieba.withDict(dict)
const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const deriveWorkspaceStatus = (nodes: WorkspaceNode[]): WorkspaceSource['status'] => {
  if (nodes.some((node) => node.prepare_status === 'failed')) return 'failed'
  if (nodes.some((node) => node.prepare_status === 'stale')) return 'stale'
  if (nodes.some((node) => node.prepare_status === 'preparing')) return 'preparing'
  if (nodes.some((node) => node.prepare_status === 'prepared')) return 'prepared'
  return 'not_prepared'
}

const mergeScannedNodes = (params: {
  existingNodes: WorkspaceNode[]
  nextNodes: WorkspaceNode[]
  changedNodes: WorkspaceNode[]
  now: number
}): WorkspaceNode[] => {
  const existingMap = new Map(
    params.existingNodes.map((node) => [getWorkspaceScopeKey(node), node] as const)
  )
  const changedKeys = new Set(params.changedNodes.map((node) => getWorkspaceScopeKey(node)))

  return params.nextNodes.map((node) => {
    const existingNode = existingMap.get(getWorkspaceScopeKey(node))
    if (!existingNode) return node
    if (changedKeys.has(getWorkspaceScopeKey(node)) && node.kind === 'file') {
      return {
        ...node,
        document_id: existingNode.document_id,
        content_hash: node.content_hash || existingNode.content_hash,
        last_prepared_at: existingNode.last_prepared_at,
        last_error: existingNode.last_error,
        prepare_status: existingNode.document_id ? 'stale' : 'not_prepared',
        created_at: existingNode.created_at,
        updated_at: params.now
      }
    }
    return {
      ...node,
      content_hash: existingNode.content_hash,
      document_id: existingNode.document_id,
      last_prepared_at: existingNode.last_prepared_at,
      last_error: existingNode.last_error,
      prepare_status: existingNode.prepare_status,
      created_at: existingNode.created_at,
      updated_at: params.now
    }
  })
}

const normalizeSelectedSourceScopes = (
  scopes: AiRunStartRequest['selectedSourceScopes']
): SourceScopeSelection[] | undefined => {
  if (!Array.isArray(scopes)) return undefined
  const normalized = scopes
    .map((scope) => ({
      ...scope,
      sourceId: String(scope.sourceId || '').trim(),
      nodeId: scope.nodeId ? String(scope.nodeId).trim() : undefined,
      label: String(scope.label || '').trim(),
      absolutePath: scope.absolutePath ? String(scope.absolutePath).trim() : undefined,
      relativePath: scope.relativePath ? String(scope.relativePath).trim() : undefined,
      documentIds: Array.isArray(scope.documentIds) ? scope.documentIds.map(String).filter(Boolean) : [],
      workspace:
        scope.workspace &&
        String(scope.workspace.workspaceId || '').trim() &&
        String(scope.workspace.rootPath || '').trim()
          ? {
              workspaceId: String(scope.workspace.workspaceId).trim(),
              rootPath: String(scope.workspace.rootPath).trim(),
              policyProfile: scope.workspace.policyProfile
                ? String(scope.workspace.policyProfile)
                : undefined
            }
          : undefined
    }))
    .filter((scope) => scope.sourceId && scope.label)
  return normalized.length > 0 ? normalized : undefined
}

export function registerHandlers(services: {
  ingestionService: IngestionService
  embeddingService: EmbeddingService
  storageService: StorageService
  modelService: ModelService
}) {
  const { ingestionService, embeddingService, storageService, modelService } = services
  const activeAiRuns = new Map<string, { cancelled: boolean; senderId: number }>()
  const activeWorkspacePrepareJobs = new Set<string>()
  const activeAiApprovals = new Map<
    string,
    Map<
      string,
      {
        taskId: string
        resolve: (decision: { approved: boolean; reason?: string }) => void
      }
    >
  >()
  const documentsStore = storageService.documents
  const chatStore = storageService.chat
  const llmStore = storageService.llm
  const webSourceStore = storageService.webSource
  const workspaceStore = storageService.workspace
  const workspaceService = new WorkspaceSourceService()
  const webSourceService = new WebSourceService()

  const emitSourceListRefresh = (sender: Electron.WebContents) => {
    sender.send('source-list-refresh')
  }

  const ensureWebSourcesHydrated = async (): Promise<void> => {
    const existingSources = await webSourceStore.listWebSources()
    const existingByDocumentId = new Map(
      existingSources
        .filter((source) => source.document_id)
        .map((source) => [source.document_id || '', source] as const)
    )
    const webDocuments = (await documentsStore.listDocuments({ page: 1, pageSize: 2000 })).items.filter(
      (document) => document.source_type === 'web'
    )

    for (const document of webDocuments) {
      if (existingByDocumentId.has(document.id)) continue
      const rawUrl = String(document.source_url || document.file_path || document.name || '').trim()
      if (!rawUrl) continue
      try {
        const { url, normalizedUrl } = webSourceService.normalizeUrl(rawUrl)
        const existing = await webSourceStore.getWebSourceByNormalizedUrl(normalizedUrl)
        const now = Date.now()
        if (existing) {
          await webSourceStore.updateWebSource(existing.id, {
            url,
            title: document.source_title || document.name,
            document_id: document.id,
            import_status: document.import_status,
            fetched_at: document.fetched_at || document.created_at,
            last_error: document.last_error,
            updated_at: now
          })
          continue
        }
        const source = webSourceService.createWebSource({
          url,
          normalizedUrl,
          title: document.source_title || document.name,
          documentId: document.id,
          importStatus: document.import_status,
          fetchedAt: document.fetched_at || document.created_at,
          lastError: document.last_error,
          now
        })
        await webSourceStore.saveWebSource(source)
      } catch (error) {
        void error
      }
    }
  }

  const refreshWebSourceRecord = async (
    event: Electron.IpcMainInvokeEvent,
    source: WebSourceRecord
  ): Promise<{ source: WebSourceRecord; chunkCount: number }> => {
    const now = Date.now()
    const nextDocumentId = source.document_id || uuidv4()
    const nextPendingSource: WebSourceRecord = {
      ...source,
      document_id: nextDocumentId,
      import_status: 1,
      last_error: undefined,
      updated_at: now
    }
    await webSourceStore.saveWebSource(nextPendingSource)

    const existingDocument = source.document_id
      ? await documentsStore.getDocumentById(source.document_id)
      : null
    if (existingDocument) {
      await documentsStore.updateDocumentById(existingDocument.id, {
        name: source.title || source.url,
        file_path: source.url,
        source_type: 'web'
      })
      await documentsStore.updateDocumentImportStatus(existingDocument.id, 1)
      await documentsStore.deleteChunksByDocumentIds([existingDocument.id])
    } else {
      await documentsStore.addDocument({
        id: nextDocumentId,
        name: source.title || source.url,
        source_type: 'web',
        file_path: source.url,
        created_at: now,
        import_status: 1,
        source_id: source.id,
        source_url: source.url,
        source_title: source.title,
        normalized_source_url: source.normalized_url
      })
    }

    emitSourceListRefresh(event.sender)

    try {
      const splitDocs = await ingestionService.processWebUrl({
        url: source.url,
        includeSelectors: source.include_selectors,
        excludeSelectors: source.exclude_selectors
      })
      const documentName = splitDocs.title?.trim() || source.url
      await documentsStore.updateDocumentById(nextDocumentId, {
        name: documentName,
        file_path: source.url,
        source_type: 'web'
      })

      const allSplitDocs = [...splitDocs.bigSplitDocs, ...splitDocs.miniSplitDocs]
      const allChunkVectors: Float32Array[] = []
      for (const doc of allSplitDocs) {
        const { data: vector } = await embeddingService.embed(doc.pageContent)
        allChunkVectors.push(vector)
      }

      const chunks = allChunkVectors.map((_, index) => ({
        text: allSplitDocs[index].pageContent,
        id: uuidv4(),
        document_id: nextDocumentId,
        document_name: documentName,
        source_type: 'web',
        metadata: {
          page: 1
        }
      }))

      await documentsStore.addChunks({
        vectors: allChunkVectors,
        chunks
      })
      await documentsStore.updateDocumentImportStatus(nextDocumentId, 2)

      const refreshedSource: WebSourceRecord = {
        ...nextPendingSource,
        title: documentName,
        import_status: 2,
        fetched_at: Date.now(),
        last_error: undefined,
        updated_at: Date.now()
      }
      await webSourceStore.saveWebSource(refreshedSource)
      emitSourceListRefresh(event.sender)
      return { source: refreshedSource, chunkCount: chunks.length }
    } catch (error: unknown) {
      await documentsStore.updateDocumentImportStatus(nextDocumentId, 3).catch(() => {})
      const failedSource: WebSourceRecord = {
        ...nextPendingSource,
        import_status: 3,
        last_error: getErrorMessage(error),
        updated_at: Date.now()
      }
      await webSourceStore.saveWebSource(failedSource)
      emitSourceListRefresh(event.sender)
      throw error
    }
  }

  ipcMain.handle(
    'ingest-web',
    async (
      event,
      payload: { url: string; includeSelectors?: string[]; excludeSelectors?: string[] }
    ) => {
      try {
        await ensureWebSourcesHydrated()
        const rawUrl = String(payload?.url || '').trim()
        if (!rawUrl) throw new Error('URL 不能为空')
        const { url, normalizedUrl } = webSourceService.normalizeUrl(rawUrl)
        const existing = await webSourceStore.getWebSourceByNormalizedUrl(normalizedUrl)
        const source =
          existing ||
          webSourceService.createWebSource({
            url,
            normalizedUrl,
            includeSelectors: payload.includeSelectors,
            excludeSelectors: payload.excludeSelectors,
            importStatus: 1
          })
        const nextSource: WebSourceRecord = {
          ...source,
          url,
          normalized_url: normalizedUrl,
          include_selectors: payload.includeSelectors,
          exclude_selectors: payload.excludeSelectors,
          updated_at: Date.now()
        }
        if (!existing) {
          await webSourceStore.saveWebSource(nextSource)
        } else {
          await webSourceStore.updateWebSource(existing.id, {
            url,
            include_selectors: payload.includeSelectors,
            exclude_selectors: payload.excludeSelectors,
            updated_at: nextSource.updated_at
          })
        }
        const refreshed = await refreshWebSourceRecord(event, nextSource)
        return {
          success: true,
          count: refreshed.chunkCount,
          source: refreshed.source
        }
      } catch (error: unknown) {
        console.error('❌ [INGEST-WEB] ERROR:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  ipcMain.handle(
    'ingest-webs',
    async (
      event,
      payload: Array<{ url: string; includeSelectors?: string[]; excludeSelectors?: string[] }>
    ) => {
      try {
        await ensureWebSourcesHydrated()
        const items = Array.isArray(payload) ? payload : []
        const preparedSources: WebSourceRecord[] = []

        for (const item of items) {
          const rawUrl = String(item?.url || '').trim()
          if (!rawUrl) continue
          const { url, normalizedUrl } = webSourceService.normalizeUrl(rawUrl)
          const existing = await webSourceStore.getWebSourceByNormalizedUrl(normalizedUrl)
          const source =
            existing ||
            webSourceService.createWebSource({
              url,
              normalizedUrl,
              includeSelectors: item.includeSelectors,
              excludeSelectors: item.excludeSelectors,
              importStatus: 1
            })
          const nextSource: WebSourceRecord = {
            ...source,
            url,
            normalized_url: normalizedUrl,
            include_selectors: item.includeSelectors,
            exclude_selectors: item.excludeSelectors,
            updated_at: Date.now()
          }
          if (!existing) {
            await webSourceStore.saveWebSource(nextSource)
          } else {
            await webSourceStore.updateWebSource(existing.id, {
              url,
              include_selectors: item.includeSelectors,
              exclude_selectors: item.excludeSelectors,
              updated_at: nextSource.updated_at
            })
          }
          preparedSources.push(nextSource)
        }

        emitSourceListRefresh(event.sender)

        const concurrency = Math.max(1, WEB_INGEST_CONCURRENCY)
        let index = 0
        const runOne = async () => {
          for (;;) {
            const current = preparedSources[index++]
            if (!current) return
            try {
              await refreshWebSourceRecord(event, current)
            } catch (error) {
              console.error('❌ [INGEST-WEBS] ERROR:', error)
            }
          }
        }

        await Promise.all(Array.from({ length: concurrency }, () => runOne()))
        return { success: true, created: preparedSources.length }
      } catch (error: unknown) {
        console.error('❌ [INGEST-WEBS] ERROR:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  ipcMain.handle('open-external', async (_event, url: string) => {
    try {
      const parsed = new URL(String(url))
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return { success: false, error: '仅支持 http/https URL' }
      }
      await shell.openExternal(parsed.toString())
      return { success: true }
    } catch (error: unknown) {
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('open-path', async (_event, rawPath: string) => {
    try {
      const value = String(rawPath || '').trim()
      if (!value) return { success: false, error: 'path is required' }
      const resolved = path.resolve(value)
      if (!fs.existsSync(resolved)) return { success: false, error: 'path not found' }
      const err = await shell.openPath(resolved)
      if (err) return { success: false, error: err }
      return { success: true }
    } catch (error: unknown) {
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('reveal-path', async (_event, rawPath: string) => {
    try {
      const value = String(rawPath || '').trim()
      if (!value) return { success: false, error: 'path is required' }
      const resolved = path.resolve(value)
      if (!fs.existsSync(resolved)) return { success: false, error: 'path not found' }
      shell.showItemInFolder(resolved)
      return { success: true }
    } catch (error: unknown) {
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('workspace-list', async (): Promise<WorkspaceListResponse> => {
    try {
      const items = await workspaceStore.listWorkspaces()
      return { items, total: items.length }
    } catch (error: unknown) {
      console.error('❌ [WORKSPACE-LIST] ERROR:', error)
      return { items: [], total: 0 }
    }
  })

  ipcMain.handle(
    'workspace-create',
    async (_event, payload: CreateWorkspaceSourceRequest): Promise<WorkspaceMutationResponse> => {
      try {
        const existingWorkspaces = await workspaceStore.listWorkspaces()
        await workspaceService.assertNoNestedWorkspace(
          payload.rootPath,
          existingWorkspaces.map((workspace) => workspace.root_path)
        )

        const workspaceId = uuidv4()
        const scanResult = await workspaceService.scanWorkspace({
          workspaceId,
          rootPath: payload.rootPath,
          workspaceName: payload.name
        })
        await workspaceStore.saveWorkspace(scanResult.workspace)
        await workspaceStore.replaceWorkspaceNodes(workspaceId, scanResult.nodes)
        return { success: true, workspace: scanResult.workspace }
      } catch (error: unknown) {
        console.error('❌ [WORKSPACE-CREATE] ERROR:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  ipcMain.handle(
    'workspace-delete',
    async (_event, workspaceId: string): Promise<DeleteWorkspaceSourceResponse> => {
      try {
        await workspaceStore.deleteWorkspace(String(workspaceId || '').trim())
        return { success: true, deletedWorkspaceId: String(workspaceId || '').trim() }
      } catch (error: unknown) {
        console.error('❌ [WORKSPACE-DELETE] ERROR:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  ipcMain.handle(
    'workspace-nodes',
    async (_event, payload: ListWorkspaceNodesRequest): Promise<WorkspaceNodeListResponse> => {
      try {
        const items = await workspaceStore.listWorkspaceNodes({
          workspaceId: String(payload.workspaceId || '').trim(),
          parentId: payload.parentId ? String(payload.parentId).trim() : undefined,
          kind: payload.kind
        })
        return { items, total: items.length }
      } catch (error: unknown) {
        console.error('❌ [WORKSPACE-NODES] ERROR:', error)
        return { items: [], total: 0 }
      }
    }
  )

  ipcMain.handle(
    'workspace-scan',
    async (_event, payload: { workspaceId: string }): Promise<WorkspaceJobResponse> => {
      try {
        const workspaceId = String(payload.workspaceId || '').trim()
        const currentWorkspace = await workspaceStore.getWorkspaceById(workspaceId)
        if (!currentWorkspace) {
          return { success: false, error: 'workspace not found' }
        }

        const existingNodes = await workspaceStore.listWorkspaceNodes({ workspaceId })
        const now = Date.now()
        const scanResult = await workspaceService.scanWorkspace({
          workspaceId,
          rootPath: currentWorkspace.root_path,
          workspaceName: currentWorkspace.name,
          now
        })
        const diff = await workspaceService.diffWorkspaceNodes({
          existingNodes,
          nextNodes: scanResult.nodes,
          mode: 'full'
        })
        const mergedNodes = mergeScannedNodes({
          existingNodes,
          nextNodes: scanResult.nodes,
          changedNodes: diff.changed,
          now
        })
        const nextStatus =
          diff.changed.length > 0 || diff.added.length > 0 || diff.removed.length > 0
            ? 'stale'
            : currentWorkspace.status
        const nextWorkspace: WorkspaceSource = {
          ...currentWorkspace,
          ...scanResult.workspace,
          status: nextStatus,
          created_at: currentWorkspace.created_at,
          last_prepare_at: currentWorkspace.last_prepare_at,
          last_error: currentWorkspace.last_error,
          updated_at: now
        }

        await workspaceStore.saveWorkspace(nextWorkspace)
        await workspaceStore.replaceWorkspaceNodes(workspaceId, mergedNodes)

        return {
          success: true,
          workspaceId,
          progress: {
            workspace_id: workspaceId,
            phase: 'scan',
            total: mergedNodes.length,
            completed: mergedNodes.length,
            added: diff.added.length,
            updated: diff.changed.length,
            removed: diff.removed.length
          }
        }
      } catch (error: unknown) {
        console.error('❌ [WORKSPACE-SCAN] ERROR:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  ipcMain.handle(
    'workspace-prepare',
    async (event, payload: { workspaceId: string; mode?: string }): Promise<WorkspaceJobResponse> => {
      const workspaceId = String(payload.workspaceId || '').trim()
      const mode =
        payload.mode === 'presence_only' || payload.mode === 'changes_only'
          ? payload.mode
          : 'full'
      if (!workspaceId) return { success: false, error: 'workspaceId is required' }
      if (activeWorkspacePrepareJobs.has(workspaceId)) {
        return { success: false, error: 'workspace prepare already running' }
      }

      activeWorkspacePrepareJobs.add(workspaceId)
      try {
        const currentWorkspace = await workspaceStore.getWorkspaceById(workspaceId)
        if (!currentWorkspace) {
          return { success: false, error: 'workspace not found' }
        }

        const existingNodes = await workspaceStore.listWorkspaceNodes({ workspaceId })
        const prepareStartedAt = Date.now()
        const scanResult = await workspaceService.scanWorkspace({
          workspaceId,
          rootPath: currentWorkspace.root_path,
          workspaceName: currentWorkspace.name,
          now: prepareStartedAt
        })
        const diff = await workspaceService.diffWorkspaceNodes({
          existingNodes,
          nextNodes: scanResult.nodes,
          mode
        })
        const mergedNodes = mergeScannedNodes({
          existingNodes,
          nextNodes: scanResult.nodes,
          changedNodes: diff.changed,
          now: prepareStartedAt
        })

        const nodeMap = new Map(mergedNodes.map((node) => [getWorkspaceScopeKey(node), node] as const))
        const basePrepareTargets = [...diff.added, ...diff.changed].filter((node) => node.kind === 'file')
        const basePrepareKeys = new Set(basePrepareTargets.map((node) => getWorkspaceScopeKey(node)))
        const retryTargets = mergedNodes.filter(
          (node) =>
            node.kind === 'file' &&
            (node.prepare_status === 'failed' || node.prepare_status === 'stale') &&
            !basePrepareKeys.has(getWorkspaceScopeKey(node))
        )
        const prepareTargets = [...basePrepareTargets, ...retryTargets]
        for (const target of prepareTargets) {
          const key = getWorkspaceScopeKey(target)
          const currentNode = nodeMap.get(key)
          if (!currentNode) continue
          nodeMap.set(key, {
            ...currentNode,
            prepare_status: 'preparing',
            last_error: undefined,
            updated_at: Date.now()
          })
        }

        await workspaceStore.saveWorkspace({
          ...currentWorkspace,
          ...scanResult.workspace,
          status: 'preparing',
          created_at: currentWorkspace.created_at,
          last_prepare_at: currentWorkspace.last_prepare_at,
          updated_at: prepareStartedAt,
          last_error: undefined
        })
        await workspaceStore.replaceWorkspaceNodes(workspaceId, Array.from(nodeMap.values()))

        const removedDocumentIds = diff.removed
          .filter((node) => node.kind === 'file' && node.document_id)
          .map((node) => node.document_id as string)
        if (removedDocumentIds.length > 0) {
          await documentsStore.deleteDocumentsByIds(removedDocumentIds)
        }

        let completed = 0
        let failed = 0
        for (const target of prepareTargets) {
          const key = getWorkspaceScopeKey(target)
          const currentNode = nodeMap.get(key)
          if (!currentNode) continue
          const documentId = currentNode.document_id || uuidv4()
          try {
            const existingDocument = await documentsStore.getDocumentById(documentId)
            if (existingDocument) {
              await documentsStore.updateDocumentById(documentId, {
                name: currentNode.name,
                file_path: currentNode.absolute_path,
                source_type: 'file'
              })
              await documentsStore.updateDocumentImportStatus(documentId, 1)
            } else {
              await documentsStore.addDocument({
                id: documentId,
                name: currentNode.name,
                source_type: 'file',
                file_path: currentNode.absolute_path,
                created_at: Date.now(),
                import_status: 1
              })
            }

            await documentsStore.deleteChunksByDocumentIds([documentId])
            const splitDocs = await ingestionService.processFile(currentNode.absolute_path)
            const allSplitDocs = [...splitDocs.bigSplitDocs, ...splitDocs.miniSplitDocs]
            const vectors: Float32Array[] = []
            for (const doc of allSplitDocs) {
              const { data: vector } = await embeddingService.embed(doc.pageContent)
              vectors.push(vector)
            }

            const chunks = vectors.map((_, index) => ({
              text: allSplitDocs[index].pageContent,
              id: uuidv4(),
              document_id: documentId,
              document_name: currentNode.name,
              source_type: 'file',
              metadata: {
                page: allSplitDocs[index].metadata.loc?.pageNumber || 1
              }
            }))

            await documentsStore.addChunks({ vectors, chunks })
            await documentsStore.updateDocumentImportStatus(documentId, 2)

            const preparedAt = Date.now()
            const contentHash = await workspaceService.computeContentHash(currentNode.absolute_path)
            const preparedNode: WorkspaceNode = {
              ...currentNode,
              document_id: documentId,
              content_hash: contentHash,
              prepare_status: 'prepared',
              last_prepared_at: preparedAt,
              last_error: undefined,
              updated_at: preparedAt
            }
            nodeMap.set(key, preparedNode)
            await workspaceStore.updateWorkspaceNode(preparedNode.id, {
              document_id: preparedNode.document_id,
              content_hash: preparedNode.content_hash,
              prepare_status: preparedNode.prepare_status,
              last_prepared_at: preparedNode.last_prepared_at,
              last_error: preparedNode.last_error,
              updated_at: preparedNode.updated_at
            })
            completed += 1
          } catch (error: unknown) {
            failed += 1
            await documentsStore.updateDocumentImportStatus(documentId, 3).catch(() => {})
            const failedAt = Date.now()
            const failedNode: WorkspaceNode = {
              ...currentNode,
              document_id: documentId,
              prepare_status: 'failed',
              last_error: getErrorMessage(error),
              updated_at: failedAt
            }
            nodeMap.set(key, failedNode)
            await workspaceStore.updateWorkspaceNode(failedNode.id, {
              document_id: failedNode.document_id,
              prepare_status: failedNode.prepare_status,
              last_error: failedNode.last_error,
              updated_at: failedNode.updated_at
            })
          }
        }

        const finalNodes = Array.from(nodeMap.values()).sort((a, b) =>
          a.relative_path.localeCompare(b.relative_path)
        )
        const finishedAt = Date.now()
        const nextWorkspace: WorkspaceSource = {
          ...currentWorkspace,
          ...scanResult.workspace,
          status: deriveWorkspaceStatus(finalNodes),
          created_at: currentWorkspace.created_at,
          last_scan_at: scanResult.workspace.last_scan_at,
          last_prepare_at: finishedAt,
          updated_at: finishedAt,
          last_error: failed > 0 ? `${failed} file(s) failed during prepare` : undefined
        }
        await workspaceStore.saveWorkspace(nextWorkspace)
        await workspaceStore.replaceWorkspaceNodes(workspaceId, finalNodes)
        emitSourceListRefresh(event.sender)

        return {
          success: true,
          workspaceId,
          progress: {
            workspace_id: workspaceId,
            mode,
            phase: 'complete',
            total: prepareTargets.length,
            completed,
            added: diff.added.length,
            updated: diff.changed.length,
            removed: diff.removed.length,
            failed
          }
        }
      } catch (error: unknown) {
        await workspaceStore.updateWorkspace(workspaceId, {
          status: 'failed',
          last_error: getErrorMessage(error),
          updated_at: Date.now()
        })
        return { success: false, error: getErrorMessage(error), workspaceId }
      } finally {
        activeWorkspacePrepareJobs.delete(workspaceId)
      }
    }
  )

  ipcMain.handle('web-source-list', async (): Promise<WebSourceListResponse> => {
    try {
      await ensureWebSourcesHydrated()
      const items = await webSourceStore.listWebSources()
      return { items, total: items.length }
    } catch (error: unknown) {
      console.error('❌ [WEB-SOURCE-LIST] ERROR:', error)
      return { items: [], total: 0 }
    }
  })

  ipcMain.handle('legacy-local-import-migration-status', async () => {
    return storageService.getLegacyLocalImportMigrationStatus()
  })

  ipcMain.handle(
    'web-source-refresh',
    async (
      event,
      payload: { webSourceId: string }
    ): Promise<WebSourceMutationResponse> => {
      try {
        await ensureWebSourcesHydrated()
        const webSourceId = String(payload.webSourceId || '').trim()
        if (!webSourceId) {
          return { success: false, error: 'webSourceId is required' }
        }
        const source = await webSourceStore.getWebSourceById(webSourceId)
        if (!source) {
          return { success: false, error: 'web source not found' }
        }
        const refreshed = await refreshWebSourceRecord(event, source)
        return { success: true, source: refreshed.source }
      } catch (error: unknown) {
        console.error('❌ [WEB-SOURCE-REFRESH] ERROR:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  ipcMain.handle(
    'web-source-delete',
    async (event, webSourceId: string): Promise<DeleteWebSourceResponse> => {
      try {
        await ensureWebSourcesHydrated()
        const safeId = String(webSourceId || '').trim()
        const source = await webSourceStore.getWebSourceById(safeId)
        if (!source) {
          return { success: false, error: 'web source not found' }
        }
        if (source.document_id) {
          await documentsStore.deleteDocumentsByIds([source.document_id])
        }
        await webSourceStore.deleteWebSource(safeId)
        emitSourceListRefresh(event.sender)
        return { success: true, deletedWebSourceId: safeId }
      } catch (error: unknown) {
        console.error('❌ [WEB-SOURCE-DELETE] ERROR:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  ipcMain.handle(
    'source-scope-list',
    async (_event, payload: ListSourceScopesRequest): Promise<SourceScopeListResponse> => {
      try {
        await ensureWebSourcesHydrated()
        const workspaceItems = await workspaceStore.listWorkspaces()
        const localScopes: SourceScopeSelection[] = []
        for (const workspace of workspaceItems) {
          const nodes = await workspaceStore.listWorkspaceNodes({ workspaceId: workspace.id })
          localScopes.push(...buildWorkspaceScopeSelections(workspace, nodes))
        }

        const webScopes = (await webSourceStore.listWebSources())
          .map(buildWebScopeSelection)
          .filter((scope): scope is SourceScopeSelection => Boolean(scope))

        const allScopes = [...localScopes, ...webScopes]
          .filter((scope) => scopeMatchesQuery(scope, payload.query))
          .filter((scope) => (payload.mode === 'search' ? shouldIncludeScopeInSearch(scope) : true))

        return { items: allScopes, total: allScopes.length }
      } catch (error: unknown) {
        console.error('❌ [SOURCE-SCOPE-LIST] ERROR:', error)
        return { items: [], total: 0 }
      }
    }
  )

  ipcMain.handle(
    'search',
    async (
      _event,
      query: string,
      sourceType?: 'all' | 'file' | 'web',
      documentIds?: string[]
    ) => {
    try {
      const { data: queryVector } = await embeddingService.embed(query)
      const filter = sourceType && sourceType !== 'all' ? sourceType : undefined
      const results = await documentsStore.search(queryVector, query, 5, filter, documentIds)

      const tokens = jieba.cutForSearch(query, true)

      const finalResults = results.map(normalizeForIpc)

      return {
        results: finalResults,
        tokens
      }
    } catch (error: unknown) {
      console.error('❌ [SEARCH] ERROR:', error)
      throw error
    }
    }
  )

  ipcMain.handle(
    'fts-search',
    async (
      _event,
      query: string,
      sourceType?: 'all' | 'file' | 'web',
      documentIds?: string[]
    ): Promise<SearchResult[]> => {
      try {
        const filter = sourceType && sourceType !== 'all' ? sourceType : undefined
        const results = await documentsStore.ftsSearch(query, 20, filter, documentIds)
        const normalized = results.map(normalizeForIpc)
        // console.log('🔎 [FTS-SEARCH] RESULTS:', normalized)
        return normalized
      } catch (error: unknown) {
        console.error('❌ [FTS-SEARCH] ERROR:', error)
        return []
      }
    }
  )

  ipcMain.handle(
    'vector-search',
    async (
      _event,
      query: string,
      sourceType?: 'all' | 'file' | 'web',
      documentIds?: string[]
    ): Promise<SearchResult[]> => {
      try {
        const { data: queryVector } = await embeddingService.embed(query)
        const filter = sourceType && sourceType !== 'all' ? sourceType : undefined
        const results = await documentsStore.vectorSearch(queryVector, 20, filter, documentIds)
        const normalized = results.map(normalizeForIpc)
        console.log('🔎 [VECTOR-SEARCH] RESULTS:', normalized)
        return normalized
      } catch (error: unknown) {
        console.error('❌ [VECTOR-SEARCH] ERROR:', error)
        return []
      }
    }
  )

  ipcMain.handle(
    'hybrid-search',
    async (
      _event,
      query: string,
      sourceType?: 'all' | 'file' | 'web',
      documentIds?: string[]
    ): Promise<SearchResult[]> => {
      try {
        const { data: queryVector } = await embeddingService.embed(query)
        const filter = sourceType && sourceType !== 'all' ? sourceType : undefined
        const results = await documentsStore.hybridSearch(queryVector, query, 20, filter, documentIds)
        const normalized = results.map(normalizeForIpc)
        console.log('🔎 [HYBRID-SEARCH] RESULTS:', normalized)
        return normalized
      } catch (error: unknown) {
        console.error('❌ [HYBRID-SEARCH] ERROR:', error)
        return []
      }
    }
  )

  ipcMain.handle(
    'list-documents',
    async (
      _event,
      payload: { keyword?: string; page: number; pageSize: number }
    ): Promise<DocumentListResponse> => {
      try {
        const { keyword, page, pageSize } = payload
        const res = await documentsStore.listDocuments({ keyword, page, pageSize })
        return res
      } catch (error: unknown) {
        console.error('❌ [LIST-DOCUMENTS] ERROR:', error)
        return { items: [], total: 0 }
      }
    }
  )

  ipcMain.handle(
    'list-chunks',
    async (
      _event,
      payload: { keyword?: string; page: number; pageSize: number }
    ): Promise<ChunkListResponse> => {
      try {
        const { keyword, page, pageSize } = payload
        const res = await documentsStore.listChunks({ keyword, page, pageSize })
        const normalized = res.items.map(normalizeForIpc)
        return { items: normalized, total: res.total }
      } catch (error: unknown) {
        console.error('❌ [LIST-CHUNKS] ERROR:', error)
        return { items: [], total: 0 }
      }
    }
  )

  ipcMain.handle('drop-documents-table', async () => {
    try {
      const result = await documentsStore.dropDocumentsStorage()
      console.log('🗑️ [DROP-DOCUMENTS] DONE:', result)
      return { success: true, existed: result.existed }
    } catch (error: unknown) {
      console.error('❌ [DROP-DOCUMENTS] ERROR:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('delete-documents', async (event, ids: string[]) => {
    try {
      console.log('🗑️ [DELETE-DOCUMENTS] REQUEST:', ids)
      const res = await documentsStore.deleteDocumentsByIds(ids || [])
      console.log('🗑️ [DELETE-DOCUMENTS] DONE:', res)
      emitSourceListRefresh(event.sender)
      return res
    } catch (error: unknown) {
      console.error('❌ [DELETE-DOCUMENTS] ERROR:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('read-file', async (_event, filePath: string) => {
    try {
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`)
      }
      const buffer = fs.readFileSync(filePath)
      return buffer
    } catch (error: unknown) {
      console.error('❌ [READ-FILE] ERROR:', error)
      throw error
    }
  })

  ipcMain.handle('download-model', async (event, repoId: string) => {
    try {
      const result = await modelService.downloadModel(repoId, event.sender)
      // After successful download, re-initialize embedding service
      await embeddingService.initialize()
      return result
    } catch (error: unknown) {
      console.error('❌ [DOWNLOAD-MODEL] ERROR:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('get-models', async () => {
    try {
      return modelService.getModels()
    } catch (error: unknown) {
      console.error('❌ [GET-MODELS] ERROR:', error)
      return []
    }
  })

  ipcMain.handle('get-embedding-status', () => {
    return embeddingService.getStatus()
  })

  ipcMain.handle(
    'ai-run-start',
    async (event, payload: AiRunStartRequest): Promise<AiRunStartResponse> => {
      const sessionId = String(payload?.sessionId || '').trim()
      const input = String(payload?.input || '').trim()
      const selectedDocumentIds = Array.isArray(payload?.selectedDocumentIds)
        ? payload.selectedDocumentIds.map(String).filter(Boolean)
        : undefined
      const selectedSourceScopes = normalizeSelectedSourceScopes(payload?.selectedSourceScopes)
      const inferredWorkspace = selectedSourceScopes?.find((scope) => scope.workspace)?.workspace
      const workspace =
        payload?.workspace &&
        String(payload.workspace.workspaceId || '').trim() &&
        String(payload.workspace.rootPath || '').trim()
          ? {
              workspaceId: String(payload.workspace.workspaceId).trim(),
              rootPath: String(payload.workspace.rootPath).trim(),
              policyProfile: payload.workspace.policyProfile
                ? String(payload.workspace.policyProfile)
                : undefined
            }
          : inferredWorkspace
            ? {
                workspaceId: inferredWorkspace.workspaceId,
                rootPath: inferredWorkspace.rootPath,
                policyProfile: inferredWorkspace.policyProfile
              }
          : undefined
      const allowNonLocal = Boolean(payload?.allowNonLocal)
      if (!sessionId) return { success: false, error: 'sessionId is required' }
      if (!input) return { success: false, error: 'input is required' }

      const runId = uuidv4()
      activeAiRuns.set(runId, { cancelled: false, senderId: event.sender.id })
      activeAiApprovals.set(runId, new Map())

      const sendEvent = (evt: AiRunEvent) => {
        if (event.sender.isDestroyed()) return
        event.sender.send('ai-run-event', evt)
      }

      const validation = await validateSelectedScopesForRun({
        scopes: selectedSourceScopes,
        workspaceStore,
        webSourceStore,
        sendEvent,
        runId
      })
      if (!validation.ok) {
        activeAiApprovals.delete(runId)
        activeAiRuns.delete(runId)
        return { success: false, error: validation.error }
      }

      sendEvent({ type: 'run_started', runId, sessionId, createdAt: Date.now(), input })
      ;(async () => {
        const streamText = async (text: string) => {
          const raw = String(text || '')
          if (!raw) return
          const chunkSize = 24
          for (let i = 0; i < raw.length; i += chunkSize) {
            if (activeAiRuns.get(runId)?.cancelled) break
            sendEvent({ type: 'answer_token', runId, token: raw.slice(i, i + chunkSize) })
          }
          sendEvent({ type: 'answer_completed', runId, text: raw })
        }

        try {
          const result = await AiRunService.getInstance().run(
            {
              runId,
              sessionId,
              input,
              selectedDocumentIds,
              selectedSourceScopes,
              allowNonLocal,
              workspace
            },
            {
              llmStore,
              chatStore,
              documentsStore,
              embeddingService,
              isCancelled: () => Boolean(activeAiRuns.get(runId)?.cancelled),
              sendEvent,
              requestApproval: async (request) => {
                const approvals = activeAiApprovals.get(runId)
                if (!approvals) return { approved: false, reason: 'run not active' }

                const approvalId = uuidv4()
                sendEvent({
                  type: 'approval_required',
                  runId,
                  taskId: request.taskId,
                  approvalId,
                  command: request.command,
                  riskLevel: request.riskLevel,
                  reason: request.reason,
                  createdAt: Date.now(),
                  internal: request.internal,
                  stage: request.stage
                })

                return await new Promise<{ approved: boolean; reason?: string }>((resolve) => {
                  const timeout = setTimeout(() => {
                    approvals.delete(approvalId)
                    sendEvent({
                      type: 'approval_decision',
                      runId,
                      taskId: request.taskId,
                      approvalId,
                      approved: false,
                      reason: 'approval timeout',
                      decidedAt: Date.now(),
                      internal: request.internal,
                      stage: request.stage
                    })
                    sendEvent({
                      type: 'runtime_issue',
                      runId,
                      code: 'approval_denied',
                      message: '审批超时，当前命令不会继续执行。',
                      taskId: request.taskId,
                      createdAt: Date.now(),
                      internal: request.internal,
                      stage: request.stage
                    })
                    resolve({ approved: false, reason: 'approval timeout' })
                  }, 60_000)

                  approvals.set(approvalId, {
                    taskId: request.taskId,
                    resolve: (decision) => {
                      clearTimeout(timeout)
                      approvals.delete(approvalId)
                      sendEvent({
                        type: 'approval_decision',
                        runId,
                        taskId: request.taskId,
                        approvalId,
                        approved: Boolean(decision.approved),
                        reason: decision.reason,
                        decidedAt: Date.now(),
                        internal: request.internal,
                        stage: request.stage
                      })
                      if (!decision.approved) {
                        sendEvent({
                          type: 'runtime_issue',
                          runId,
                          code: 'approval_denied',
                          message: decision.reason || '审批未通过，当前命令不会继续执行。',
                          taskId: request.taskId,
                          createdAt: Date.now(),
                          internal: request.internal,
                          stage: request.stage
                        })
                      }
                      resolve({
                        approved: Boolean(decision.approved),
                        reason: decision.reason
                      })
                    }
                  })
                })
              }
            }
          )

          if (result.status === 'cancelled') {
            sendEvent({ type: 'run_cancelled', runId })
            return
          }

          if (result.outputText) {
            if (result.localSourceStatus && result.localSourceSummary) {
              sendEvent({
                type: 'local_sources_status',
                runId,
                status: result.localSourceStatus,
                summary: result.localSourceSummary
              })
            }
            if (result.localSourceStatus === 'insufficient' && result.localSourceSummary) {
              sendEvent({
                type: 'non_local_permission_requested',
                runId,
                reason: result.localSourceSummary
              })
            }
            await streamText(result.outputText)
          }

          if (result.status === 'failed') {
            sendEvent({ type: 'run_failed', runId, error: result.error || 'failed' })
            return
          }

          try {
            await updateSessionMemoryAfterRun({
              sessionId,
              userInput: input,
              assistantOutput: result.outputText || '',
              chatStore,
              llmStore
            })
          } catch (e) {
            void e
          }

          sendEvent({ type: 'run_completed', runId })
        } catch (e: unknown) {
          if (activeAiRuns.get(runId)?.cancelled) {
            sendEvent({ type: 'run_cancelled', runId })
            return
          }
          const msg = e instanceof Error ? getErrorMessage(e) : String(e)
          sendEvent({ type: 'run_failed', runId, error: msg })
        } finally {
          await releaseDocxRunSession(runId)
          const approvals = activeAiApprovals.get(runId)
          if (approvals) {
            for (const [approvalId, pending] of approvals.entries()) {
              pending.resolve({ approved: false, reason: 'run closed' })
              approvals.delete(approvalId)
            }
          }
          activeAiApprovals.delete(runId)
          activeAiRuns.delete(runId)
        }
      })()

      return { success: true, runId }
    }
  )

  ipcMain.handle('ai-run-cancel', async (_event, runId: string): Promise<AiRunCancelResponse> => {
    const entry = activeAiRuns.get(String(runId || ''))
    if (!entry) return { success: false, error: 'run not found' }
    entry.cancelled = true
    return { success: true }
  })

  ipcMain.handle(
    'ai-run-approval-decide',
    async (
      _event,
      payload: AiRunApprovalDecisionRequest
    ): Promise<AiRunApprovalDecisionResponse> => {
      const runId = String(payload?.runId || '').trim()
      const approvalId = String(payload?.approvalId || '').trim()
      if (!runId || !approvalId) {
        return { success: false, error: 'runId and approvalId are required' }
      }

      const approvals = activeAiApprovals.get(runId)
      if (!approvals) return { success: false, error: 'run not found' }

      const pending = approvals.get(approvalId)
      if (!pending) return { success: false, error: 'approval not found' }

      pending.resolve({
        approved: Boolean(payload?.approved),
        reason: payload?.reason ? String(payload.reason) : undefined
      })

      return { success: true }
    }
  )

  // === Chat & LLM Handlers ===

  ipcMain.handle('chat-session-list', async () => {
    try {
      return await chatStore.getChatSessions()
    } catch (e: unknown) {
      console.error('[CHAT-SESSION-LIST] Error:', e)
      return []
    }
  })

  ipcMain.handle('chat-session-save', async (_event, session: ChatSession) => {
    try {
      await chatStore.saveChatSession(session)
      return { success: true }
    } catch (e: unknown) {
      console.error('[CHAT-SESSION-SAVE] Error:', e)
      return { success: false, error: getErrorMessage(e) }
    }
  })

  ipcMain.handle('chat-session-delete', async (_event, id: string) => {
    try {
      await chatStore.deleteChatSession(id)
      return { success: true }
    } catch (e: unknown) {
      console.error('[CHAT-SESSION-DELETE] Error:', e)
      return { success: false, error: getErrorMessage(e) }
    }
  })

  ipcMain.handle('chat-message-list', async (_event, sessionId: string) => {
    try {
      return await chatStore.getChatMessages(sessionId)
    } catch (e: unknown) {
      console.error('[CHAT-MESSAGE-LIST] Error:', e)
      return []
    }
  })

  ipcMain.handle('chat-message-save', async (_event, message: ChatMessage) => {
    try {
      await chatStore.saveChatMessage(message)
      return { success: true }
    } catch (e: unknown) {
      console.error('[CHAT-MESSAGE-SAVE] Error:', e)
      return { success: false, error: getErrorMessage(e) }
    }
  })

  ipcMain.handle('llm-config-list', async () => {
    try {
      return await llmStore.list()
    } catch (e: unknown) {
      console.error('[LLM-CONFIG-LIST] Error:', e)
      return []
    }
  })

  ipcMain.handle('llm-config-save', async (_event, config: LLMConfig) => {
    try {
      await llmStore.save(config)
      return { success: true }
    } catch (e: unknown) {
      console.error('[LLM-CONFIG-SAVE] Error:', e)
      return { success: false, error: getErrorMessage(e) }
    }
  })

  ipcMain.handle('llm-config-delete', async (_event, id: string) => {
    try {
      await llmStore.delete(id)
      return { success: true }
    } catch (e: unknown) {
      console.error('[LLM-CONFIG-DELETE] Error:', e)
      return { success: false, error: getErrorMessage(e) }
    }
  })

  ipcMain.handle('llm-config-set-active', async (_event, id: string) => {
    try {
      await llmStore.setActive(id)
      return { success: true }
    } catch (e: unknown) {
      console.error('[LLM-CONFIG-SET-ACTIVE] Error:', e)
      return { success: false, error: getErrorMessage(e) }
    }
  })
}
