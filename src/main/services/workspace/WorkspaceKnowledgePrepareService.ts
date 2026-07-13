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
  WorkspaceKnowledgeWebInput
} from './types'
import { WORKSPACE_CHUNK_WRITE_BATCH_SIZE } from './constants'
import {
  buildWorkspaceKnowledgeChunks,
  buildWorkspaceKnowledgeVectors,
  computeWorkspaceFileContentHash
} from './utils/knowledge'
import { WorkspacePrepareWorkerClient } from './worker/workspacePrepareWorkerClient'

export class WorkspaceKnowledgePrepareService {
  private readonly workerClient = new WorkspacePrepareWorkerClient()

  public constructor(
    private readonly deps: {
      embeddingService: EmbeddingService
      documentsStore: DocumentsStore
    }
  ) {}

  public async indexLocalFile(
    input: WorkspaceKnowledgeIndexInput
  ): Promise<WorkspaceKnowledgeIndexResult> {
    if (!isSupportedLocalFilePath(input.filePath)) {
      throw new Error(`Unsupported file type: ${input.filePath}`)
    }

    const contentHash = await this.computeContentHash(input.filePath)
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
    const preparedSource = await this.workerClient.prepareSource({
      sourceType: 'file',
      filePath: input.filePath,
      cachedSplit
    })
    const indexedDocument = await this.buildPreparedDocument({
      preparedSource,
      workspaceId: input.workspaceId,
      documentId: input.documentId,
      documentName: input.documentName,
      cachedVectors
    })

    const usedCachedSplit = this.isUsableCachedSplit(cachedSplit, preparedSource)
    const usedCachedVectors = this.isUsableCachedVectors(cachedVectors, preparedSource)
    await this.persistCacheSnapshots({
      indexedDocument,
      cache: input.cache,
      usedCachedSplit,
      usedCachedVectors
    })

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
      usedCachedVectors
    })
  }

  public async indexWebText(
    input: WorkspaceKnowledgeWebInput
  ): Promise<WorkspaceKnowledgeIndexResult> {
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
    const preparedSource = await this.workerClient.prepareSource({
      sourceType: 'web',
      documentName: input.documentName,
      sourceUrl: input.sourceUrl,
      rawText: input.rawText,
      contentHash,
      cachedSplit
    })
    const indexedDocument = await this.buildPreparedDocument({
      preparedSource,
      workspaceId: input.workspaceId,
      documentId: input.documentId,
      documentName: input.documentName,
      cachedVectors
    })

    const usedCachedSplit = this.isUsableCachedSplit(cachedSplit, preparedSource)
    const usedCachedVectors = this.isUsableCachedVectors(cachedVectors, preparedSource)
    await this.persistCacheSnapshots({
      indexedDocument,
      cache: input.cache,
      usedCachedSplit,
      usedCachedVectors
    })

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
      usedCachedVectors
    })
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
            chunks: preparedSource.splitSnapshot.chunks
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
  }): Promise<WorkspaceKnowledgeIndexResult> {
    const indexedDocument = input.indexedDocument

    const now = Date.now()
    const newGenerationId = uuidv4()
    let oldGenerationId: string | undefined
    try {
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

      if (indexedDocument.chunks.length > 0) {
        await this.addChunksFromVectorSnapshot({
          chunks: indexedDocument.chunks,
          vectors: indexedDocument.vectorSnapshot.vectors,
          generationId: newGenerationId
        })
      }
      await this.deps.documentsStore.activateDocumentGeneration({
        documentId: input.documentId,
        generationId: newGenerationId,
        contentHash: input.contentHash,
        importStatus: 2,
        updatedAt: Date.now()
      })
      if (oldGenerationId && oldGenerationId !== newGenerationId) {
        void this.deps.documentsStore
          .deleteChunksByGeneration({
            documentId: input.documentId,
            workspaceId: input.workspaceId,
            generationId: oldGenerationId
          })
          .catch((error) => {
            console.warn('[WORKSPACE-INDEX] failed to cleanup old generation:', error)
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
