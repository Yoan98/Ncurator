import path from 'node:path'
import { v4 as uuidv4 } from 'uuid'
import type { DocumentsStore } from '../storage/domains/DocumentsStore'
import type { EmbeddingService } from '../vector/EmbeddingService'
import { ensureEmbeddingReady } from '../vector/ensureEmbeddingReady'
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

class IndexPrepareRestoreError extends Error {
  public constructor(documentId: string, cause: unknown) {
    super(
      `取消索引后恢复文档 ${documentId} 失败：${cause instanceof Error ? cause.message : String(cause)}`,
      { cause }
    )
    this.name = 'IndexPrepareRestoreError'
  }
}

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
    if (!input.cache) return this.indexLocalFileUnlocked(input)
    const contentHash = await this.computeContentHash(input.filePath)
    return input.cache.withLock(
      `file:${contentHash}:${path.basename(input.filePath)}`,
      () => this.indexLocalFileUnlocked(input),
      input.signal
    )
  }

  private async indexLocalFileUnlocked(
    input: WorkspaceKnowledgeIndexInput
  ): Promise<WorkspaceKnowledgeIndexResult> {
    this.throwIfAborted(input.signal)
    if (!isSupportedLocalFilePath(input.filePath)) {
      throw new Error(`Unsupported file type: ${input.filePath}`)
    }
    await ensureEmbeddingReady({ embeddingService: this.deps.embeddingService })
    this.throwIfAborted(input.signal)

    const stopAbort = this.listenForAbort(input.signal, () => {
      void this.abortActivePrepare()
    })
    try {
      const contentHash = await this.computeContentHash(input.filePath)
      this.throwIfAborted(input.signal)
      const fileExt = path.extname(input.filePath).toLowerCase()
      const cachedSplit = input.cache
        ? await input.cache.loadSplitSnapshot({
            contentHash,
            fileExt,
            sourceName: path.basename(input.filePath)
          })
        : null
      const baseSource = await this.prepareSource({
        sourceType: 'file',
        filePath: input.filePath,
        cachedSplit
      })
      const preparedSource = this.applyEmbeddingInputBudget(baseSource)
      this.throwIfAborted(input.signal)
      if (input.cache && !this.isUsableCachedSplit(cachedSplit, preparedSource)) {
        await input.cache.saveSplitSnapshot(baseSource.splitSnapshot, path.basename(input.filePath))
      }
      const cachedVectors = input.cache
        ? await input.cache.loadVectorSnapshot({
            contentHash,
            fileExt,
            modelName: this.deps.embeddingService.getIndexIdentity(),
            texts: preparedSource.splitSnapshot.chunks.map((chunk) => chunk.text)
          })
        : null
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
      if (error instanceof IndexPrepareRestoreError) throw error
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
    if (!input.cache) return this.indexWebTextUnlocked(input)
    return input.cache.withLock(
      `web:${input.contentHash}:${input.documentName}:${input.sourceUrl}`,
      () => this.indexWebTextUnlocked(input),
      input.signal
    )
  }

  private async indexWebTextUnlocked(
    input: WorkspaceKnowledgeWebInput
  ): Promise<WorkspaceKnowledgeIndexResult> {
    this.throwIfAborted(input.signal)
    await ensureEmbeddingReady({ embeddingService: this.deps.embeddingService })
    this.throwIfAborted(input.signal)
    const stopAbort = this.listenForAbort(input.signal, () => {
      void this.abortActivePrepare()
    })
    try {
      const contentHash = input.contentHash
      const fileExt = '.html'
      const cachedSplit = input.cache
        ? await input.cache.loadSplitSnapshot({
            contentHash,
            fileExt,
            sourceName: `${input.documentName}\n${input.sourceUrl}`
          })
        : null
      const baseSource = await this.prepareSource({
        sourceType: 'web',
        documentName: input.documentName,
        sourceUrl: input.sourceUrl,
        rawText: input.rawText,
        contentHash,
        cachedSplit
      })
      const preparedSource = this.applyEmbeddingInputBudget(baseSource)
      this.throwIfAborted(input.signal)
      if (input.cache && !this.isUsableCachedSplit(cachedSplit, preparedSource)) {
        await input.cache.saveSplitSnapshot(
          baseSource.splitSnapshot,
          `${input.documentName}\n${input.sourceUrl}`
        )
      }
      const cachedVectors = input.cache
        ? await input.cache.loadVectorSnapshot({
            contentHash,
            fileExt,
            modelName: this.deps.embeddingService.getIndexIdentity(),
            texts: preparedSource.splitSnapshot.chunks.map((chunk) => chunk.text)
          })
        : null
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
      if (error instanceof IndexPrepareRestoreError) throw error
      if (input.signal?.aborted) throw new IndexPrepareCancelledError()
      throw error
    } finally {
      stopAbort()
    }
  }

  private applyEmbeddingInputBudget(source: WorkspacePreparedSource): WorkspacePreparedSource {
    const chunks = this.deps.embeddingService.prepareDocumentChunks(source.splitSnapshot.chunks)
    return { ...source, splitSnapshot: { ...source.splitSnapshot, chunks } }
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
      cachedVectors.modelName === this.deps.embeddingService.getIndexIdentity() &&
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
    const identity = this.deps.embeddingService.getIndexIdentity()
    const usesCachedVectors = this.isUsableCachedVectors(input.cachedVectors, preparedSource)
    let vectorSnapshot: WorkspaceKnowledgeVectorSnapshot
    if (usesCachedVectors && input.cachedVectors) {
      vectorSnapshot = input.cachedVectors
    } else if (preparedSource.splitSnapshot.chunks.length === 0) {
      vectorSnapshot = {
        contentHash: preparedSource.contentHash,
        fileExt: preparedSource.fileExt,
        modelName: identity,
        vectors: []
      }
    } else {
      vectorSnapshot = {
        contentHash: preparedSource.contentHash,
        fileExt: preparedSource.fileExt,
        modelName: identity,
        vectors: (
          await buildWorkspaceKnowledgeVectors({
            embeddingService: this.deps.embeddingService,
            chunks: preparedSource.splitSnapshot.chunks,
            signal: input.signal
          })
        ).vectors
      }
    }

    if (identity !== this.deps.embeddingService.getIndexIdentity()) {
      throw new Error('向量模型已切换，请重新生成索引。')
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
    usedCachedVectors: boolean
  }): Promise<void> {
    if (!input.cache) return
    if (!input.usedCachedVectors) {
      await input.cache.saveVectorSnapshot(
        input.indexedDocument.vectorSnapshot,
        input.indexedDocument.splitSnapshot.chunks.map((chunk) => chunk.text)
      )
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
    if (process.env.NCURATOR_WORKSPACE_KNOWLEDGE_CACHE === '1') {
      console.info(
        `[workspace-knowledge] ${input.documentName}: split=${input.usedCachedSplit ? 'hit' : 'computed'} vectors=${input.usedCachedVectors ? 'hit' : 'computed'} chunks=${input.indexedDocument.chunkCount}`
      )
    }
    return this.deps.documentsStore.runGenerationWrite(async () => {
      const indexedDocument = input.indexedDocument
      const identity = indexedDocument.vectorSnapshot.modelName
      const vectors = indexedDocument.vectorSnapshot.vectors
      const dimension = vectors[0]?.length ?? 0
      if (
        vectors.length !== indexedDocument.chunks.length ||
        vectors.some(
          (vector) => !dimension || vector.length !== dimension || !vector.every(Number.isFinite)
        )
      ) {
        throw new Error('资料向量的数量或维度不一致，请重新生成索引。')
      }
      if (identity !== this.deps.embeddingService.getIndexIdentity()) {
        throw new Error('向量模型已切换，请重新生成索引。')
      }

      const now = Date.now()
      const newGenerationId = uuidv4()
      let oldGenerationId: string | undefined
      let restoreDocument: (() => boolean) | undefined
      let wroteChunks = false
      let activated = false
      try {
        this.throwIfAborted(input.signal)
        const indexing = this.deps.documentsStore.beginDocumentIndexing(
          {
            id: input.documentId,
            name: input.documentName,
            file_path: input.filePath,
            source_type: input.sourceType,
            workspace_id: input.workspaceId,
            created_at: input.createdAt || now,
            content_hash: input.contentHash
          },
          now
        )
        oldGenerationId = indexing.previousGenerationId
        restoreDocument = indexing.restore

        this.throwIfAborted(input.signal)
        if (indexedDocument.chunks.length > 0) {
          await this.addChunksFromVectorSnapshot({
            chunks: indexedDocument.chunks,
            vectors: indexedDocument.vectorSnapshot.vectors,
            generationId: newGenerationId,
            embeddingIdentity: identity
          })
          wroteChunks = true
        }
        this.throwIfAborted(input.signal)
        if (identity !== this.deps.embeddingService.getIndexIdentity()) {
          throw new Error('向量模型已切换，请重新生成索引。')
        }
        await this.deps.documentsStore.activateDocumentGeneration({
          documentId: input.documentId,
          generationId: newGenerationId,
          contentHash: input.contentHash,
          embeddingIdentity: identity,
          dimension: indexedDocument.vectorSnapshot.vectors[0]?.length ?? 0,
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
        const cancelled = isIndexPrepareCancelledError(error) || Boolean(input.signal?.aborted)
        if (wroteChunks && !activated) {
          await this.deps.documentsStore
            .deleteChunksByGeneration({
              documentId: input.documentId,
              workspaceId: input.workspaceId,
              generationId: newGenerationId
            })
            .catch(() => {})
        }
        if (cancelled) {
          if (!activated && restoreDocument) {
            try {
              restoreDocument()
            } catch (restoreError) {
              throw new IndexPrepareRestoreError(input.documentId, restoreError)
            }
          }
          throw new IndexPrepareCancelledError()
        }
        await this.deps.documentsStore
          .markDocumentIndexFailed(
            input.documentId,
            error instanceof Error ? error.message : String(error)
          )
          .catch(() => {})
        throw new Error(error instanceof Error ? error.message : String(error))
      }
    })
  }

  public async computeContentHash(filePath: string): Promise<string> {
    return await computeWorkspaceFileContentHash(filePath)
  }

  private async addChunksFromVectorSnapshot(input: {
    chunks: WorkspaceKnowledgeChunkInput[]
    vectors: number[][]
    generationId: string
    embeddingIdentity: string
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
        generationId: input.generationId,
        embeddingIdentity: input.embeddingIdentity
      })
    }
  }
}
