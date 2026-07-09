import path from 'node:path'
import { v4 as uuidv4 } from 'uuid'
import type { DocumentsStore } from '../storage/domains/DocumentsStore'
import type { EmbeddingService } from '../vector/EmbeddingService'
import { isSupportedLocalFilePath } from '../ingestion/loader'
import type {
  WorkspaceKnowledgeChunkInput,
  WorkspaceKnowledgeIndexInput,
  WorkspaceKnowledgeIndexResult
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
      ? await input.cache.loadSplitSnapshot({
          contentHash,
          fileExt
        })
      : null
    const cachedVectors = input.cache
      ? await input.cache.loadVectorSnapshot({
          contentHash,
          fileExt,
          modelName: this.deps.embeddingService.getModelName()
        })
      : null
    const indexedDocument = await getWorkspaceIndexWorkerClient().prepareFile({
      workspaceId: input.workspaceId,
      documentId: input.documentId,
      filePath: input.filePath,
      documentName: input.documentName,
      cachedSplit,
      cachedVectors
    })
    const usedCachedSplit = Boolean(cachedSplit)
    const usedCachedVectors =
      Boolean(cachedVectors) &&
      cachedVectors?.vectors.length === indexedDocument.splitSnapshot.chunks.length
    if (!usedCachedSplit && input.cache) {
      await input.cache.saveSplitSnapshot(indexedDocument.splitSnapshot)
    }
    if (!usedCachedVectors && input.cache) {
      await input.cache.saveVectorSnapshot(indexedDocument.vectorSnapshot)
    }

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
          source_type: 'file',
          workspace_id: input.workspaceId,
          content_hash: contentHash
        })
        await this.deps.documentsStore.markDocumentIndexing(input.documentId, now)
      } else {
        await this.deps.documentsStore.addDocument({
          id: input.documentId,
          name: input.documentName,
          source_type: 'file',
          workspace_id: input.workspaceId,
          file_path: input.filePath,
          created_at: input.createdAt || now,
          updated_at: now,
          import_status: 1,
          content_hash: contentHash
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
        contentHash,
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
        fileExt,
        documentName: input.documentName,
        generationId: newGenerationId,
        contentHash,
        chunkCount: indexedDocument.chunks.length,
        usedCachedSplit,
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
    for (
      let start = 0;
      start < input.chunks.length;
      start += WORKSPACE_CHUNK_WRITE_BATCH_SIZE
    ) {
      const batchChunks = input.chunks.slice(
        start,
        start + WORKSPACE_CHUNK_WRITE_BATCH_SIZE
      )
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
