import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { IngestionService } from '../../ingestion/loader'
import type { EmbeddingService } from '../../vector/EmbeddingService'
import { IndexPrepareCancelledError } from '../WorkspaceIndexPrepareController'
import {
  WORKSPACE_EMBEDDING_BATCH_CHUNK_COUNT,
  WORKSPACE_EMBEDDING_BATCH_MAX_CHARS,
  WORKSPACE_EMBEDDING_CHUNK_MAX_CHARS,
  WORKSPACE_KNOWLEDGE_CHUNK_ID_SCHEMA_VERSION
} from '../constants'
import type {
  WorkspaceKnowledgeChunkInput,
  WorkspaceKnowledgeChunkSnapshot,
  WorkspaceKnowledgeSplitSnapshot,
  WorkspaceKnowledgeVectorBuildResult
} from '../types'

export const buildWorkspaceKnowledgeChunkId = (input: {
  documentId: string
  contentHash: string
  index: number
}): string =>
  createHash('sha1')
    .update(
      `${WORKSPACE_KNOWLEDGE_CHUNK_ID_SCHEMA_VERSION}:${input.documentId}:${input.contentHash}:${String(input.index)}`
    )
    .digest('hex')

export const computeWorkspaceFileContentHash = async (filePath: string): Promise<string> => {
  const fileBuffer = await fs.readFile(filePath)
  return createHash('sha1').update(fileBuffer).digest('hex')
}

export const buildWorkspaceKnowledgeSplitSnapshot = async (input: {
  ingestionService: IngestionService
  filePath: string
  contentHash: string
  fileExt?: string
}): Promise<WorkspaceKnowledgeSplitSnapshot> => {
  const processed = await input.ingestionService.processFile(input.filePath)
  const chunks: { text: string; page: number }[] = []
  if (processed.anchorText) {
    chunks.push({ text: processed.anchorText, page: 1 })
  }
  if (!processed.metadataOnly) {
    chunks.push(
      ...processed.bigSplitDocs.map((doc) => ({
        text: doc.pageContent,
        page: Number(doc.metadata.loc?.pageNumber || 1)
      })),
      ...processed.miniSplitDocs.map((doc) => ({
        text: doc.pageContent,
        page: Number(doc.metadata.loc?.pageNumber || 1)
      }))
    )
  }
  return {
    contentHash: input.contentHash,
    fileExt: input.fileExt || path.extname(input.filePath).toLowerCase(),
    chunks
  }
}

/** 网页正文源的 split 快照：走 processWebText，产出与文件一致的结构 */
export const buildWorkspaceKnowledgeSplitSnapshotFromText = async (input: {
  ingestionService: IngestionService
  url: string
  title?: string
  text: string
  contentHash: string
  fileExt?: string
}): Promise<WorkspaceKnowledgeSplitSnapshot> => {
  const splitDocs = await input.ingestionService.processWebText({
    url: input.url,
    title: input.title,
    text: input.text
  })
  const allSplitDocs = [...splitDocs.bigSplitDocs, ...splitDocs.miniSplitDocs]
  return {
    contentHash: input.contentHash,
    fileExt: input.fileExt || '.html',
    chunks: allSplitDocs.map((doc) => ({
      text: doc.pageContent,
      page: Number(doc.metadata.loc?.pageNumber || 1)
    }))
  }
}

export const buildWorkspaceKnowledgeChunks = (input: {
  workspaceId: string
  documentId: string
  documentName: string
  contentHash: string
  sourceType?: 'file' | 'web'
  chunks: WorkspaceKnowledgeChunkSnapshot[]
}): WorkspaceKnowledgeChunkInput[] =>
  input.chunks.map((chunk, index) => ({
    id: buildWorkspaceKnowledgeChunkId({
      documentId: input.documentId,
      contentHash: input.contentHash,
      index
    }),
    text: chunk.text,
    document_id: input.documentId,
    workspace_id: input.workspaceId,
    document_name: input.documentName,
    source_type: input.sourceType || 'file',
    metadata: {
      page: chunk.page
    }
  }))

export const createWorkspaceEmbeddingBatches = (
  chunks: WorkspaceKnowledgeChunkSnapshot[]
): WorkspaceKnowledgeChunkSnapshot[][] => {
  const batches: WorkspaceKnowledgeChunkSnapshot[][] = []
  let currentBatch: WorkspaceKnowledgeChunkSnapshot[] = []
  let currentChars = 0

  const flush = (): void => {
    if (currentBatch.length === 0) return
    batches.push(currentBatch)
    currentBatch = []
    currentChars = 0
  }

  for (const chunk of chunks) {
    const textLength = chunk.text.length
    if (textLength > WORKSPACE_EMBEDDING_CHUNK_MAX_CHARS) {
      throw new Error(
        `chunk is too large to embed: ${textLength} chars, max ${WORKSPACE_EMBEDDING_CHUNK_MAX_CHARS}`
      )
    }

    if (textLength > WORKSPACE_EMBEDDING_BATCH_MAX_CHARS) {
      flush()
      batches.push([chunk])
      continue
    }

    const exceedsChunkCount = currentBatch.length >= WORKSPACE_EMBEDDING_BATCH_CHUNK_COUNT
    const exceedsCharBudget =
      currentBatch.length > 0 && currentChars + textLength > WORKSPACE_EMBEDDING_BATCH_MAX_CHARS
    if (exceedsChunkCount || exceedsCharBudget) {
      flush()
    }

    currentBatch.push(chunk)
    currentChars += textLength
  }

  flush()
  return batches
}

export const buildWorkspaceKnowledgeVectors = async (input: {
  embeddingService: EmbeddingService
  chunks: WorkspaceKnowledgeChunkSnapshot[]
  signal?: AbortSignal
}): Promise<WorkspaceKnowledgeVectorBuildResult> => {
  const vectors: number[][] = []
  const batches = createWorkspaceEmbeddingBatches(input.chunks)
  for (const batch of batches) {
    if (input.signal?.aborted) throw new IndexPrepareCancelledError()
    const embeddings = await input.embeddingService.embed(batch.map((chunk) => chunk.text))
    const vectorSize = embeddings.dims[1]
    vectors.push(
      ...batch.map((_, index) =>
        Array.from(embeddings.data.slice(index * vectorSize, (index + 1) * vectorSize))
      )
    )
  }
  if (input.signal?.aborted) throw new IndexPrepareCancelledError()
  return { vectors }
}
