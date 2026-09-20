import path from 'node:path'
import { v4 as uuidv4 } from 'uuid'
import type { DocumentsStore } from '../storage/domains/DocumentsStore'
import type { EmbeddingService } from '../vector/EmbeddingService'
import { isSupportedLocalFilePath } from '../ingestion/loader'
import type {
  WorkspaceKnowledgeChunkInput,
  WorkspaceKnowledgeIndexInput,
  WorkspaceKnowledgeIndexResult,
  WorkspaceKnowledgePreparedDocument,
  WorkspaceKnowledgeVectorSnapshot,
  WorkspacePreparedSource,
  WorkspacePrepareWorkerInput,
  WorkspaceKnowledgeWebInput
} from './types'
import { WORKSPACE_CHUNK_WRITE_BATCH_SIZE } from './constants'
import {
  buildWorkspaceKnowledgeChunks,
  buildWorkspaceKnowledgeVectors,
  computeWorkspaceFileContentHash
} from './utils/knowledge'
import { WorkspacePrepareWorkerClient } from './worker/workspacePrepareWorkerClient'
import type { AppErrorLogService } from '../logging/AppErrorLogService'
import {
  IndexPrepareCancelledError,
  isIndexPrepareCancelledError
} from './WorkspaceIndexPrepareController'

export class WorkspaceKnowledgePrepareService {
  private readonly workerClient: WorkspacePrepareWorkerClient

  public constructor(
    private readonly deps: {
      embeddingService: EmbeddingService
      documentsStore: DocumentsStore
      errorLogService?: AppErrorLogService
      prepareSource?: (input: WorkspacePrepareWorkerInput) => Promise<WorkspacePreparedSource>
    }
  ) {
    this.workerClient = new WorkspacePrepareWorkerClient({
      errorLogService: this.deps.errorLogService
    })
  }

  private async prepareSource(
    input: WorkspacePrepareWorkerInput
  ): Promise<WorkspacePreparedSource> {
    if (this.deps.prepareSource) {
      return await this.deps.prepareSource(input)
    }
    return await this.workerClient.prepareSource(input)
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw new IndexPrepareCancelledError()
  }

  private listenForAbort(signal: AbortSignal | undefined, onAbort: () => void): () => void {
    if (!signal) return () => {}
    if (signal.aborted) {
      onAbort()
      return () => {}
    }
    const listener = (): void => onAbort()
    signal.addEventListener('abort', listener, { once: true })
    return () => signal.removeEventListener('abort', listener)
  }

  public async abortActivePrepare(): Promise<void> {
    await this.workerClient.close()
  }

  public async indexLocalFile(
    input: WorkspaceKnowledgeIndexInput
  ): Promise<WorkspaceKnowledgeIndexResult> {
    this.throwIfAborted(input.signal)
    if (!isSupportedLocalFilePath(input.filePath)) {
      throw new Error(`Unsupported file type: ${input.filePath}`)
    }

    const stopAbort = this.listenForAbort(input.signal, () => {
      void this.abortActivePrepare()
    })
    try {
      const contentHash = await this.computeContentHash(input.filePath)
      this.throwIfAborted(input.signal)
      const fileExt = path.extname(input.filePath).toLowerCase()
      const cachedSplit = input.cache
        ? await input.cache.loadSplitSnapshot({ contentHash, fileExt })
        : null
      const cachedVectors = input.cache
        ? await input.cache.loadVectorSnapshot({
            contentHash,
            fileExt,
            modelName: this.deps.embeddingService.getModelName()
          })
        : null
      const preparedSource = await this.prepareSource({
        sourceType: 'file',
        filePath: input.filePath,
        cachedSplit
      })
      this.throwIfAborted(input.signal)
      const indexedDocument = await this.buildPreparedDocument({
        preparedSource,
        workspaceId: input.workspaceId,
        documentId: input.documentId,
        documentName: input.documentName,
        cachedVectors,
        signal: input.signal
      })
      this.throwIfAborted(input.signal)

      const usedCachedSplit = this.isUsableCachedSplit(cachedSplit, preparedSource)
      const usedCachedVectors = this.isUsableCachedVectors(cachedVectors, preparedSource)
      await this.persistCacheSnapshots({
        indexedDocument,
        cache: input.cache,
        usedCachedSplit,
        usedCachedVectors
      })
      this.throwIfAborted(input.signal)

      return await this.writeIndexedDocument({
        indexedDocument,
        workspaceId: input.workspaceId,
        documentId: input.documentId,
        documentName: input.documentName,
        filePath: input.filePath,
        sourceType: 'file',
        contentHash: preparedSource.contentHash,
        fileExt: preparedSource.fileExt,
        createdAt: input.createdAt,
        usedCachedSplit,
        usedCachedVectors,
        signal: input.signal
      })
    } catch (error) {
      if (input.signal?.aborted) throw new IndexPrepareCancelledError()
      throw error
    } finally {
      stopAbort()
    }
  }

  public async indexWebText(
    input: WorkspaceKnowledgeWebInput
  ): Promise<WorkspaceKnowledgeIndexResult> {
    this.throwIfAborted(input.signal)
    const stopAbort = this.listenForAbort(input.signal, () => {
      void this.abortActivePrepare()
    })
    try {
      const contentHash = input.contentHash
      const fileExt = '.html'
      const cachedSplit = input.cache
        ? await input.cache.loadSplitSnapshot({ contentHash, fileExt })
        : null
      const cachedVectors = input.cache
        ? await input.cache.loadVectorSnapshot({
            contentHash,
            fileExt,
            modelName: this.deps.embeddingService.getModelName()
          })
        : null
      const preparedSource = await this.prepareSource({
        sourceType: 'web',
        documentName: input.documentName,
        sourceUrl: input.sourceUrl,
        rawText: input.rawText,
        contentHash,
        cachedSplit
      })
      this.throwIfAborted(input.signal)
      const indexedDocument = await this.buildPreparedDocument({
        preparedSource,
        workspaceId: input.workspaceId,
        documentId: input.documentId,
        documentName: input.documentName,
        cachedVectors,
        signal: input.signal
      })
      this.throwIfAborted(input.signal)

      const usedCachedSplit = this.isUsableCachedSplit(cachedSplit, preparedSource)
      const usedCachedVectors = this.isUsableCachedVectors(cachedVectors, preparedSource)
      await this.persistCacheSnapshots({
        indexedDocument,
        cache: input.cache,
        usedCachedSplit,
        usedCachedVectors
      })
      this.throwIfAborted(input.signal)

      return await this.writeIndexedDocument({
        indexedDocument,
        workspaceId: input.workspaceId,
        documentId: input.documentId,
        documentName: input.documentName,
        filePath: input.sourceUrl,
        sourceType: 'web',
        contentHash: preparedSource.contentHash,
        fileExt: preparedSource.fileExt,
        createdAt: input.createdAt,
        usedCachedSplit,
        usedCachedVectors,
        signal: input.signal
      })
    } catch (error) {
      if (input.signal?.aborted) throw new IndexPrepareCancelledError()
      throw error
    } finally {
      stopAbort()
    }
  }

  private isUsableCachedSplit(
    cachedSplit: { contentHash: string } | null,
    preparedSource: WorkspacePreparedSource
  ): boolean {
    return Boolean(cachedSplit && cachedSplit.contentHash === preparedSource.contentHash)
  }

  private isUsableCachedVectors(
    cachedVectors: WorkspaceKnowledgeVectorSnapshot | null,
    preparedSource: WorkspacePreparedSource
  ): boolean {
    return Boolean(
      cachedVectors &&
      cachedVectors.contentHash === preparedSource.contentHash &&
      cachedVectors.modelName === this.deps.embeddingService.getModelName() &&
      cachedVectors.vectors.length === preparedSource.splitSnapshot.chunks.length
    )
  }

  private async buildPreparedDocument(input: {
    preparedSource: WorkspacePreparedSource
    workspaceId: string
    documentId: string
    documentName: string
    cachedVectors: WorkspaceKnowledgeVectorSnapshot | null
    signal?: AbortSignal
  }): Promise<WorkspaceKnowledgePreparedDocument> {
    const { preparedSource } = input
    const usesCachedVectors = this.isUsableCachedVectors(input.cachedVectors, preparedSource)
    let vectorSnapshot: WorkspaceKnowledgeVectorSnapshot
    if (usesCachedVectors && input.cachedVectors) {
      vectorSnapshot = input.cachedVectors
    } else if (preparedSource.splitSnapshot.chunks.length === 0) {
      vectorSnapshot = {
        contentHash: preparedSource.contentHash,
        fileExt: preparedSource.fileExt,
        modelName: this.deps.embeddingService.getModelName(),
        vectors: []
      }
    } else {
      if (this.deps.embeddingService.getStatus() !== 'ready') {
        await this.deps.embeddingService.initialize()
      }
      if (this.deps.embeddingService.getStatus() !== 'ready') {
        throw new Error(
          `EmbeddingService is not ready. Current status: ${this.deps.embeddingService.getStatus()}`
        )
      }
      vectorSnapshot = {
        contentHash: preparedSource.contentHash,
        fileExt: preparedSource.fileExt,
        modelName: this.deps.embeddingService.getModelName(),
        vectors: (
          await buildWorkspaceKnowledgeVectors({
            embeddingService: this.deps.embeddingService,
            chunks: preparedSource.splitSnapshot.chunks,
            signal: input.signal
          })
        ).vectors
      }
    }

    return {
      documentId: input.documentId,
      filePath: preparedSource.filePath,
      fileExt: preparedSource.fileExt,
      documentName: input.documentName,
      contentHash: preparedSource.contentHash,
      chunkCount: preparedSource.splitSnapshot.chunks.length,
      splitSnapshot: preparedSource.splitSnapshot,
      vectorSnapshot,
      chunks: buildWorkspaceKnowledgeChunks({
        workspaceId: input.workspaceId,
        documentId: input.documentId,
        documentName: input.documentName,
        contentHash: preparedSource.contentHash,
        sourceType: preparedSource.sourceType,
        chunks: preparedSource.splitSnapshot.chunks
      })
    }
  }

  private async persistCacheSnapshots(input: {
    indexedDocument: WorkspaceKnowledgePreparedDocument
    cache?: WorkspaceKnowledgeIndexInput['cache']
    usedCachedSplit: boolean
    usedCachedVectors: boolean
  }): Promise<void> {
    if (!input.cache) return
    if (!input.usedCachedSplit) {
      await input.cache.saveSplitSnapshot(input.indexedDocument.splitSnapshot)
    }
    if (!input.usedCachedVectors) {
      await input.cache.saveVectorSnapshot(input.indexedDocument.vectorSnapshot)
    }
  }

  private async writeIndexedDocument(input: {
    indexedDocument: WorkspaceKnowledgePreparedDocument
    workspaceId: string
    documentId: string
    documentName: string
    filePath: string
    sourceType: 'file' | 'web'
    contentHash: string
    fileExt: string
    createdAt?: number
    usedCachedSplit: boolean
    usedCachedVectors: boolean
    signal?: AbortSignal
  }): Promise<WorkspaceKnowledgeIndexResult> {
    const indexedDocument = input.indexedDocument

    const now = Date.now()
    const newGenerationId = uuidv4()
    let oldGenerationId: string | undefined
    let wroteChunks = false
    let activated = false
    try {
      this.throwIfAborted(input.signal)
      const existingDocument = await this.deps.documentsStore.getDocumentById(input.documentId)
      oldGenerationId = existingDocument?.active_generation_id
      if (existingDocument) {
        await this.deps.documentsStore.updateDocumentById(input.documentId, {
          name: input.documentName,
          file_path: input.filePath,
          source_type: input.sourceType,
          workspace_id: input.workspaceId,
          content_hash: input.contentHash
        })
        await this.deps.documentsStore.markDocumentIndexing(input.documentId, now)
      } else {
        await this.deps.documentsStore.addDocument({
          id: input.documentId,
          name: input.documentName,
          source_type: input.sourceType,
          workspace_id: input.workspaceId,
          file_path: input.filePath,
          created_at: input.createdAt || now,
          updated_at: now,
          import_status: 1,
          content_hash: input.contentHash
        })
      }

      this.throwIfAborted(input.signal)
      if (indexedDocument.chunks.length > 0) {
        await this.addChunksFromVectorSnapshot({
          chunks: indexedDocument.chunks,
          vectors: indexedDocument.vectorSnapshot.vectors,
          generationId: newGenerationId
        })
        wroteChunks = true
      }
      this.throwIfAborted(input.signal)
      await this.deps.documentsStore.activateDocumentGeneration({
        documentId: input.documentId,
        generationId: newGenerationId,
        contentHash: input.contentHash,
        importStatus: 2,
        updatedAt: Date.now()
      })
      activated = true
      if (oldGenerationId && oldGenerationId !== newGenerationId) {
        await this.deps.documentsStore.deleteChunksByGeneration({
          documentId: input.documentId,
          workspaceId: input.workspaceId,
          generationId: oldGenerationId
        })
      }

      return {
        documentId: input.documentId,
        filePath: input.filePath,
        fileExt: input.fileExt,
        documentName: input.documentName,
        generationId: newGenerationId,
        contentHash: input.contentHash,
        chunkCount: indexedDocument.chunks.length,
        usedCachedSplit: input.usedCachedSplit,
        usedCachedVectors: input.usedCachedVectors,
        chunks: indexedDocument.chunks.map((chunk) => ({
          id: chunk.id,
          text: chunk.text,
          page: Number(chunk.metadata.page || 1)
        }))
      }
    } catch (error) {
      const cancelled =
        isIndexPrepareCancelledError(error) || Boolean(input.signal?.aborted)
      if (wroteChunks && !activated) {
        await this.deps.documentsStore
          .deleteChunksByGeneration({
            documentId: input.documentId,
            workspaceId: input.workspaceId,
            generationId: newGenerationId
          })
          .catch(() => {})
      }
      if (cancelled) throw new IndexPrepareCancelledError()
      await this.deps.documentsStore
        .markDocumentIndexFailed(
          input.documentId,
          error instanceof Error ? error.message : String(error)
        )
        .catch(() => {})
      throw new Error(error instanceof Error ? error.message : String(error))
    }
  }

  public async computeContentHash(filePath: string): Promise<string> {
    return await computeWorkspaceFileContentHash(filePath)
  }

  private async addChunksFromVectorSnapshot(input: {
    chunks: WorkspaceKnowledgeChunkInput[]
    vectors: number[][]
    generationId: string
  }): Promise<void> {
    for (let start = 0; start < input.chunks.length; start += WORKSPACE_CHUNK_WRITE_BATCH_SIZE) {
      const batchChunks = input.chunks.slice(start, start + WORKSPACE_CHUNK_WRITE_BATCH_SIZE)
      const batchVectors = input.vectors
        .slice(start, start + batchChunks.length)
        .map((vector) => Float32Array.from(vector))
      await this.deps.documentsStore.addChunks({
        vectors: batchVectors,
        chunks: batchChunks.map((chunk, index) => ({
          ...chunk,
          generation_id: input.generationId,
          chunk_index: start + index
        })),
        generationId: input.generationId
      })
    }
  }
}
