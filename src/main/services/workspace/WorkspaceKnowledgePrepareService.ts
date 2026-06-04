import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { DocumentsStore } from '../storage/domains/DocumentsStore'
import type { EmbeddingService } from '../vector/EmbeddingService'
import { IngestionService, isSupportedLocalFilePath } from '../ingestion/loader'
import type {
  WorkspaceKnowledgeChunkInput,
  WorkspaceKnowledgeIndexInput,
  WorkspaceKnowledgeIndexResult,
  WorkspaceKnowledgeSplitSnapshot,
  WorkspaceKnowledgeVectorSnapshot
} from './types'

const CHUNK_ID_SCHEMA_VERSION = 'workspace-knowledge-chunk-v1'
const WORKSPACE_KNOWLEDGE_EMBEDDING_BATCH_SIZE = 1

const buildChunkId = (input: {
  documentId: string
  contentHash: string
  index: number
}): string =>
  createHash('sha1')
    .update(
      `${CHUNK_ID_SCHEMA_VERSION}:${input.documentId}:${input.contentHash}:${String(input.index)}`
    )
    .digest('hex')

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export class WorkspaceKnowledgePrepareService {
  public constructor(
    private readonly deps: {
      ingestionService: IngestionService
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
    const splitSnapshot =
      cachedSplit ||
      (await this.buildSplitSnapshot({
        filePath: input.filePath,
        contentHash,
        fileExt
      }))
    if (!cachedSplit && input.cache) {
      await input.cache.saveSplitSnapshot(splitSnapshot)
    }

    const cachedVectors = input.cache
      ? await input.cache.loadVectorSnapshot({
          contentHash,
          fileExt,
          modelName: this.deps.embeddingService.getModelName()
        })
      : null
    const hasUsableCachedVectors =
      Boolean(cachedVectors) && cachedVectors?.vectors.length === splitSnapshot.chunks.length
    const vectorSnapshot = input.cache
      ? hasUsableCachedVectors
        ? cachedVectors
        : await this.buildVectorSnapshot({
            splitSnapshot,
            modelName: this.deps.embeddingService.getModelName()
          })
      : null
    if (!hasUsableCachedVectors && vectorSnapshot && input.cache) {
      await input.cache.saveVectorSnapshot(vectorSnapshot)
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

      const chunks = splitSnapshot.chunks.map((chunk, index) => ({
        id: buildChunkId({
          documentId: input.documentId,
          contentHash,
          index
        }),
        text: chunk.text,
        document_id: input.documentId,
        workspace_id: input.workspaceId,
        document_name: input.documentName,
        source_type: 'file' as const,
        metadata: {
          page: chunk.page
        }
      }))

      if (chunks.length > 0) {
        if (vectorSnapshot) {
          await this.addChunksFromVectorSnapshot({
            chunks,
            vectors: vectorSnapshot.vectors
          })
        } else {
          await this.addChunksWithBatchedEmbedding(chunks)
        }
      }
      await this.deps.documentsStore.updateDocumentImportStatus(input.documentId, 2)

      return {
        documentId: input.documentId,
        filePath: input.filePath,
        fileExt,
        documentName: input.documentName,
        contentHash,
        chunkCount: chunks.length,
        usedCachedSplit: Boolean(cachedSplit),
        usedCachedVectors: hasUsableCachedVectors,
        chunks: chunks.map((chunk) => ({
          id: chunk.id,
          text: chunk.text,
          page: Number(chunk.metadata.page || 1)
        }))
      }
    } catch (error: unknown) {
      await this.deps.documentsStore.updateDocumentImportStatus(input.documentId, 3).catch(() => {})
      throw new Error(getErrorMessage(error))
    }
  }

  public async computeContentHash(filePath: string): Promise<string> {
    const fileBuffer = await fs.readFile(filePath)
    return createHash('sha1').update(fileBuffer).digest('hex')
  }

  private async buildSplitSnapshot(input: {
    filePath: string
    contentHash: string
    fileExt: string
  }): Promise<WorkspaceKnowledgeSplitSnapshot> {
    const splitDocs = await this.deps.ingestionService.processFile(input.filePath)
    const allSplitDocs = [...splitDocs.bigSplitDocs, ...splitDocs.miniSplitDocs]
    return {
      contentHash: input.contentHash,
      fileExt: input.fileExt,
      chunks: allSplitDocs.map((doc) => ({
        text: doc.pageContent,
        page: Number(doc.metadata.loc?.pageNumber || 1)
      }))
    }
  }

  private async buildVectorSnapshot(input: {
    splitSnapshot: WorkspaceKnowledgeSplitSnapshot
    modelName: string
  }): Promise<WorkspaceKnowledgeVectorSnapshot> {
    if (input.splitSnapshot.chunks.length === 0) {
      return {
        contentHash: input.splitSnapshot.contentHash,
        fileExt: input.splitSnapshot.fileExt,
        modelName: input.modelName,
        vectors: []
      }
    }

    const vectors: number[][] = []
    for (
      let start = 0;
      start < input.splitSnapshot.chunks.length;
      start += WORKSPACE_KNOWLEDGE_EMBEDDING_BATCH_SIZE
    ) {
      const batchChunks = input.splitSnapshot.chunks.slice(
        start,
        start + WORKSPACE_KNOWLEDGE_EMBEDDING_BATCH_SIZE
      )
      const embeddings = await this.deps.embeddingService.embed(
        batchChunks.map((chunk) => chunk.text)
      )
      const vectorSize = embeddings.dims[1]
      vectors.push(
        ...batchChunks.map((_, index) =>
          Array.from(embeddings.data.slice(index * vectorSize, (index + 1) * vectorSize))
        )
      )
    }

    return {
      contentHash: input.splitSnapshot.contentHash,
      fileExt: input.splitSnapshot.fileExt,
      modelName: input.modelName,
      vectors
    }
  }

  private async addChunksFromVectorSnapshot(input: {
    chunks: WorkspaceKnowledgeChunkInput[]
    vectors: number[][]
  }): Promise<void> {
    for (
      let start = 0;
      start < input.chunks.length;
      start += WORKSPACE_KNOWLEDGE_EMBEDDING_BATCH_SIZE
    ) {
      const batchChunks = input.chunks.slice(
        start,
        start + WORKSPACE_KNOWLEDGE_EMBEDDING_BATCH_SIZE
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

  private async addChunksWithBatchedEmbedding(
    chunks: WorkspaceKnowledgeChunkInput[]
  ): Promise<void> {
    for (
      let start = 0;
      start < chunks.length;
      start += WORKSPACE_KNOWLEDGE_EMBEDDING_BATCH_SIZE
    ) {
      const batchChunks = chunks.slice(start, start + WORKSPACE_KNOWLEDGE_EMBEDDING_BATCH_SIZE)
      const embeddings = await this.deps.embeddingService.embed(
        batchChunks.map((chunk) => chunk.text)
      )
      const vectorSize = embeddings.dims[1]
      await this.deps.documentsStore.addChunks({
        vectors: batchChunks.map((_, index) =>
          Float32Array.from(embeddings.data.slice(index * vectorSize, (index + 1) * vectorSize))
        ),
        chunks: batchChunks
      })
    }
  }
}
