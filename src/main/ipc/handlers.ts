import { ipcMain, shell } from 'electron'
import { IngestionService } from '../services/ingestion/loader'
import { EmbeddingService } from '../services/vector/EmbeddingService'
import { StorageService } from '../services/storage/StorageService'
import { ModelService } from '../services/model/ModelService'
import { AiRunService } from '../services/ai/AiRunService'
import { updateSessionMemoryAfterRun } from '../services/ai/memory'
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
  AiRunApprovalDecisionResponse
} from '../types/store'
import path from 'path'
import fs from 'fs'
import { DOCUMENTS_PATH } from '../utils/paths'
import { WEB_INGEST_CONCURRENCY } from '../utils/constant'
import { Jieba } from '@node-rs/jieba'
import { dict } from '@node-rs/jieba/dict'
import { normalizeForIpc } from '../utils/serialization'

const jieba = Jieba.withDict(dict)
const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export function registerHandlers(services: {
  ingestionService: IngestionService
  embeddingService: EmbeddingService
  storageService: StorageService
  modelService: ModelService
}) {
  const { ingestionService, embeddingService, storageService, modelService } = services
  const activeAiRuns = new Map<string, { cancelled: boolean; senderId: number }>()
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

  ipcMain.handle('ingest-file', async (event, filePath: string, filename: string) => {
    let documentId: string = ''
    try {
      console.log('📄 [INGEST-FILE] FILENAME:', filename)

      documentId = uuidv4()
      const docsDir = DOCUMENTS_PATH
      // Ensure directory exists
      if (!fs.existsSync(docsDir)) {
        fs.mkdirSync(docsDir, { recursive: true })
      }

      // Generate saved file path (using ID to avoid collisions, or keeping filename)
      // Strategy: documentId_filename to ensure uniqueness while keeping readability
      const savedFileName = `${filename}`
      const savedFilePath = path.join(docsDir, savedFileName)

      console.log('💾 [INGEST-FILE] COPYING FILE TO:', savedFilePath)
      fs.copyFileSync(filePath, savedFilePath)

      console.log('📝 [INGEST-FILE] ADDING DOCUMENT RECORD')
      await documentsStore.addDocument({
        id: documentId,
        name: filename,
        source_type: 'file',
        file_path: savedFilePath,
        created_at: Date.now(),
        import_status: 1
      })

      console.log('🔧 [INGEST-FILE] STEP 1: SPLIT DOCS')
      // 1. Load and Split
      const splitDocs = await ingestionService.processFile(savedFilePath)

      console.log(
        `✅ [INGEST-FILE] STEP 1 DONE: BIG=${splitDocs.bigSplitDocs.length} MINI=${splitDocs.miniSplitDocs.length}`
      )

      console.log('🧠 [INGEST-FILE] STEP 2: EMBEDDING DOCS')
      // 2. Embed
      const allSplitDocs = [...splitDocs.bigSplitDocs, ...splitDocs.miniSplitDocs]

      // Embed in batches if needed, but for now simple loop or all at once (transformers.js might handle batching or single)
      // Transformers.js pipe usually takes string or array of strings.
      // But our embed method takes string. Let's do parallel or sequential.

      const allChunkVectors: Float32Array[] = []
      for (const doc of allSplitDocs) {
        const { data: vector } = await embeddingService.embed(doc.pageContent)
        allChunkVectors.push(vector)
      }
      console.log('🧠 [INGEST-FILE] EMBEDDING COUNT:', allChunkVectors.length)

      console.log('💾 [INGEST-FILE] STEP 3: STORING DOCS')
      // 3. Store in LanceDB (Unified)
      const chunks = allChunkVectors.map((_, i) => ({
        text: allSplitDocs[i].pageContent,
        id: uuidv4(),
        document_id: documentId,
        document_name: filename,
        source_type: 'file',
        metadata: {
          page: allSplitDocs[i].metadata.loc?.pageNumber || 1
        }
      }))

      await documentsStore.addChunks({
        vectors: allChunkVectors,
        chunks
      })
      console.log('✅ [INGEST-FILE] STORED DOCS IN UNIFIED LANCEDB')
      await documentsStore.updateDocumentImportStatus(documentId, 2)
      event.sender.send('document-list-refresh')

      return { success: true, count: chunks.length }
    } catch (error: unknown) {
      console.error('❌ [INGEST-FILE] ERROR:', error)
      if (documentId) {
        await documentsStore.updateDocumentImportStatus(documentId, 3).catch(() => {})
        event.sender.send('document-list-refresh')
      }
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('ingest-files', async (event, files: Array<{ path: string; name: string }>) => {
    try {
      const docsDir = DOCUMENTS_PATH
      if (!fs.existsSync(docsDir)) {
        fs.mkdirSync(docsDir, { recursive: true })
      }
      const created: {
        id: string
        name: string
        savedPath: string
      }[] = []
      for (const f of files) {
        const documentId = uuidv4()
        const savedFileName = `${f.name}`
        const savedFilePath = path.join(docsDir, savedFileName)
        fs.copyFileSync(f.path, savedFilePath)
        await documentsStore.addDocument({
          id: documentId,
          name: f.name,
          source_type: 'file',
          file_path: savedFilePath,
          created_at: Date.now(),
          import_status: 1
        })
        created.push({ id: documentId, name: f.name, savedPath: savedFilePath })
      }
      ;(async () => {
        for (const c of created) {
          try {
            console.log(`SPLIT DOCS FOR ${c.name}`)
            const splitDocs = await ingestionService.processFile(c.savedPath)
            const allSplitDocs = [...splitDocs.bigSplitDocs, ...splitDocs.miniSplitDocs]
            const allChunkVectors: Float32Array[] = []
            console.log(`EMBED DOCS FOR ${c.name}`)
            for (const doc of allSplitDocs) {
              const { data: vector } = await embeddingService.embed(doc.pageContent)
              allChunkVectors.push(vector)
            }
            const chunks = allChunkVectors.map((_, i) => ({
              text: allSplitDocs[i].pageContent,
              id: uuidv4(),
              document_id: c.id,
              document_name: c.name,
              source_type: 'file',
              metadata: {
                page: allSplitDocs[i].metadata.loc?.pageNumber || 1
              }
            }))

            console.log(`STORE DOCS FOR ${c.name}`)
            await documentsStore.addChunks({
              vectors: allChunkVectors,
              chunks
            })
            console.log(`STORED DOCS IN UNIFIED LANCEDB FOR ${c.name}`)
            await documentsStore.updateDocumentImportStatus(c.id, 2)
            event.sender.send('document-list-refresh')
            console.log(`✅ [INGEST-FILES] DONE FOR ${c.name}`)
          } catch (error: unknown) {
            console.error('❌ [INGEST-FILES] ERROR:', error)
            await documentsStore.updateDocumentImportStatus(c.id, 3)
            event.sender.send('document-list-refresh')
          }
        }
      })()
      return { success: true, created: created.length }
    } catch (error: unknown) {
      console.error('❌ [INGEST-FILES] ERROR:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle(
    'ingest-web',
    async (
      event,
      payload: { url: string; includeSelectors?: string[]; excludeSelectors?: string[] }
    ) => {
      let documentId: string = ''
      try {
        const url = String(payload?.url || '').trim()
        if (!url) throw new Error('URL 不能为空')
        const parsed = new URL(url)
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('仅支持 http/https URL')

        documentId = uuidv4()
        await documentsStore.addDocument({
          id: documentId,
          name: url,
          source_type: 'web',
          file_path: url,
          created_at: Date.now(),
          import_status: 1
        })
        event.sender.send('document-list-refresh')

        const splitDocs = await ingestionService.processWebUrl({
          url,
          includeSelectors: payload.includeSelectors,
          excludeSelectors: payload.excludeSelectors
        })
        const documentName = splitDocs.title?.trim() || url
        if (documentName !== url) {
          await documentsStore.updateDocumentById(documentId, { name: documentName })
        }

        const allSplitDocs = [...splitDocs.bigSplitDocs, ...splitDocs.miniSplitDocs]
        const allChunkVectors: Float32Array[] = []
        for (const doc of allSplitDocs) {
          const { data: vector } = await embeddingService.embed(doc.pageContent)
          allChunkVectors.push(vector)
        }

        const chunks = allChunkVectors.map((_, i) => ({
          text: allSplitDocs[i].pageContent,
          id: uuidv4(),
          document_id: documentId,
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
        await documentsStore.updateDocumentImportStatus(documentId, 2)
        event.sender.send('document-list-refresh')
        return { success: true, count: chunks.length }
      } catch (error: unknown) {
        console.error('❌ [INGEST-WEB] ERROR:', error)
        if (documentId) {
          await documentsStore.updateDocumentImportStatus(documentId, 3).catch(() => {})
          event.sender.send('document-list-refresh')
        }
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
        const items = Array.isArray(payload) ? payload : []
        const created: Array<{
          id: string
          url: string
          includeSelectors?: string[]
          excludeSelectors?: string[]
        }> = []

        for (const item of items) {
          const url = String(item?.url || '').trim()
          if (!url) continue
          const parsed = new URL(url)
          if (!['http:', 'https:'].includes(parsed.protocol)) continue

          const documentId = uuidv4()
          await documentsStore.addDocument({
            id: documentId,
            name: url,
            source_type: 'web',
            file_path: url,
            created_at: Date.now(),
            import_status: 1
          })
          created.push({
            id: documentId,
            url,
            includeSelectors: item.includeSelectors,
            excludeSelectors: item.excludeSelectors
          })
        }

        event.sender.send('document-list-refresh')

        const concurrency = Math.max(1, WEB_INGEST_CONCURRENCY)
        ;(async () => {
          let index = 0
          const runOne = async () => {
            for (;;) {
              const current = created[index++]
              if (!current) return
              try {
                const splitDocs = await ingestionService.processWebUrl({
                  url: current.url,
                  includeSelectors: current.includeSelectors,
                  excludeSelectors: current.excludeSelectors
                })
                const documentName = splitDocs.title?.trim() || current.url
                if (documentName !== current.url) {
                  await documentsStore.updateDocumentById(current.id, { name: documentName })
                }

                const allSplitDocs = [...splitDocs.bigSplitDocs, ...splitDocs.miniSplitDocs]
                const allChunkVectors: Float32Array[] = []
                for (const doc of allSplitDocs) {
                  const { data: vector } = await embeddingService.embed(doc.pageContent)
                  allChunkVectors.push(vector)
                }

                const chunks = allChunkVectors.map((_, i) => ({
                  text: allSplitDocs[i].pageContent,
                  id: uuidv4(),
                  document_id: current.id,
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
                await documentsStore.updateDocumentImportStatus(current.id, 2)
                event.sender.send('document-list-refresh')
              } catch (e: unknown) {
                console.error('❌ [INGEST-WEBS] ERROR:', e)
                await documentsStore.updateDocumentImportStatus(current.id, 3).catch(() => {})
                event.sender.send('document-list-refresh')
              }
            }
          }

          await Promise.all(Array.from({ length: concurrency }, () => runOne()))
        })()

        return { success: true, created: created.length }
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

  ipcMain.handle('search', async (_event, query: string, sourceType?: 'all' | 'file' | 'web') => {
    try {
      const { data: queryVector } = await embeddingService.embed(query)
      const filter = sourceType && sourceType !== 'all' ? sourceType : undefined
      const results = await documentsStore.search(queryVector, query, 5, filter)

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
  })

  ipcMain.handle(
    'fts-search',
    async (_event, query: string, sourceType?: 'all' | 'file' | 'web'): Promise<SearchResult[]> => {
      try {
        const filter = sourceType && sourceType !== 'all' ? sourceType : undefined
        const results = await documentsStore.ftsSearch(query, 20, filter)
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
    async (_event, query: string, sourceType?: 'all' | 'file' | 'web'): Promise<SearchResult[]> => {
      try {
        const { data: queryVector } = await embeddingService.embed(query)
        const filter = sourceType && sourceType !== 'all' ? sourceType : undefined
        const results = await documentsStore.vectorSearch(queryVector, 20, filter)
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
    async (_event, query: string, sourceType?: 'all' | 'file' | 'web'): Promise<SearchResult[]> => {
      try {
        const { data: queryVector } = await embeddingService.embed(query)
        const filter = sourceType && sourceType !== 'all' ? sourceType : undefined
        const results = await documentsStore.hybridSearch(queryVector, query, 20, filter)
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
      event.sender.send('document-list-refresh')
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
          : undefined
      if (!sessionId) return { success: false, error: 'sessionId is required' }
      if (!input) return { success: false, error: 'input is required' }

      const runId = uuidv4()
      activeAiRuns.set(runId, { cancelled: false, senderId: event.sender.id })
      activeAiApprovals.set(runId, new Map())

      const sendEvent = (evt: AiRunEvent) => {
        if (event.sender.isDestroyed()) return
        event.sender.send('ai-run-event', evt)
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
            { runId, sessionId, input, selectedDocumentIds, workspace },
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
