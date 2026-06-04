import path from 'node:path'
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
    try {
      const existingDocument = await this.deps.documentsStore.getDocumentById(input.documentId)
      if (existingDocument) {
        await this.deps.documentsStore.updateDocumentById(input.documentId, {
          name: input.documentName,
          file_path: input.filePath,
          source_type: 'file',
          workspace_id: input.workspaceId
        })
        await this.deps.documentsStore.updateDocumentImportStatus(input.documentId, 1)
      } else {
        await this.deps.documentsStore.addDocument({
          id: input.documentId,
          name: input.documentName,
          source_type: 'file',
          workspace_id: input.workspaceId,
          file_path: input.filePath,
          created_at: input.createdAt || now,
          import_status: 1
        })
      }

      await this.deps.documentsStore.deleteChunksByDocumentIds([input.documentId])

      if (indexedDocument.chunks.length > 0) {
        await this.addChunksFromVectorSnapshot({
          chunks: indexedDocument.chunks,
          vectors: indexedDocument.vectorSnapshot.vectors
        })
      }
      await this.deps.documentsStore.updateDocumentImportStatus(input.documentId, 2)

      return {
        documentId: input.documentId,
        filePath: input.filePath,
        fileExt,
        documentName: input.documentName,
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
      await this.deps.documentsStore.updateDocumentImportStatus(input.documentId, 3).catch(() => {})
      throw new Error(error instanceof Error ? error.message : String(error))
    }
  }

  public async computeContentHash(filePath: string): Promise<string> {
    return await computeWorkspaceFileContentHash(filePath)
  }

  private async addChunksFromVectorSnapshot(input: {
    chunks: WorkspaceKnowledgeChunkInput[]
    vectors: number[][]
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
        chunks: batchChunks
      })
    }
  }
}
