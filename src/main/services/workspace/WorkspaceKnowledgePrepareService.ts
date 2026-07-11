import path from 'node:path'
import { v4 as uuidv4 } from 'uuid'
import type { DocumentsStore } from '../storage/domains/DocumentsStore'
import type { EmbeddingService } from '../vector/EmbeddingService'
import { isSupportedLocalFilePath } from '../ingestion/loader'
import type {
  WorkspaceKnowledgeChunkInput,
  WorkspaceKnowledgeIndexInput,
  WorkspaceKnowledgeIndexResult,
  WorkspaceKnowledgePrepareWorkerResult,
  WorkspaceKnowledgeWebInput
} from './types'
import { WORKSPACE_CHUNK_WRITE_BATCH_SIZE } from './constants'
import { computeWorkspaceFileContentHash } from './utils/knowledge'
import { getWorkspaceIndexWorkerClient } from './worker/workspaceIndexWorkerClient'

export class WorkspaceKnowledgePrepareService {
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
    const indexedDocument = await getWorkspaceIndexWorkerClient().prepareSource({
      sourceType: 'file',
      workspaceId: input.workspaceId,
      documentId: input.documentId,
      filePath: input.filePath,
      documentName: input.documentName,
      cachedSplit,
      cachedVectors
    })

    await this.persistCacheSnapshots({ indexedDocument, cache: input.cache, cachedSplit, cachedVectors })

    return await this.writeIndexedDocument({
      indexedDocument,
      workspaceId: input.workspaceId,
      documentId: input.documentId,
      documentName: input.documentName,
      filePath: input.filePath,
      sourceType: 'file',
      contentHash,
      fileExt,
      createdAt: input.createdAt,
      usedCachedSplit: Boolean(cachedSplit),
      cachedVectors
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
    const indexedDocument = await getWorkspaceIndexWorkerClient().prepareSource({
      sourceType: 'web',
      workspaceId: input.workspaceId,
      documentId: input.documentId,
      documentName: input.documentName,
      sourceUrl: input.sourceUrl,
      rawText: input.rawText,
      contentHash,
      cachedSplit,
      cachedVectors
    })

    await this.persistCacheSnapshots({ indexedDocument, cache: input.cache, cachedSplit, cachedVectors })

    return await this.writeIndexedDocument({
      indexedDocument,
      workspaceId: input.workspaceId,
      documentId: input.documentId,
      documentName: input.documentName,
      filePath: input.sourceUrl,
      sourceType: 'web',
      contentHash,
      fileExt,
      createdAt: input.createdAt,
      usedCachedSplit: Boolean(cachedSplit),
      cachedVectors
    })
  }

  private async persistCacheSnapshots(input: {
    indexedDocument: WorkspaceKnowledgePrepareWorkerResult
    cache?: WorkspaceKnowledgeIndexInput['cache']
    cachedSplit: unknown
    cachedVectors: { vectors: number[][] } | null
  }): Promise<void> {
    if (!input.cache) return
    const usedCachedSplit = Boolean(input.cachedSplit)
    const usedCachedVectors =
      Boolean(input.cachedVectors) &&
      input.cachedVectors?.vectors.length === input.indexedDocument.splitSnapshot.chunks.length
    if (!usedCachedSplit) {
      await input.cache.saveSplitSnapshot(input.indexedDocument.splitSnapshot)
    }
    if (!usedCachedVectors) {
      await input.cache.saveVectorSnapshot(input.indexedDocument.vectorSnapshot)
    }
  }

  private async writeIndexedDocument(input: {
    indexedDocument: WorkspaceKnowledgePrepareWorkerResult
    workspaceId: string
    documentId: string
    documentName: string
    filePath: string
    sourceType: 'file' | 'web'
    contentHash: string
    fileExt: string
    createdAt?: number
    usedCachedSplit: boolean
    cachedVectors: { vectors: number[][] } | null
  }): Promise<WorkspaceKnowledgeIndexResult> {
    const indexedDocument = input.indexedDocument
    const usedCachedVectors =
      Boolean(input.cachedVectors) &&
      input.cachedVectors?.vectors.length === indexedDocument.splitSnapshot.chunks.length

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
        usedCachedVectors,
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
