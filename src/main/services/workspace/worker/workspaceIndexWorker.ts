import { parentPort, workerData } from 'node:worker_threads'
import path from 'node:path'
import { IngestionService, isSupportedLocalFilePath } from '../../ingestion/loader'
import { EmbeddingService } from '../../vector/EmbeddingService'
import {
  buildWorkspaceKnowledgeChunks,
  buildWorkspaceKnowledgeSplitSnapshot,
  buildWorkspaceKnowledgeSplitSnapshotFromText,
  buildWorkspaceKnowledgeVectors,
  computeWorkspaceFileContentHash
} from '../utils/knowledge'
import type {
  WorkspaceIndexWorkerRequest,
  WorkspaceIndexWorkerResponse,
  WorkspaceKnowledgePrepareWorkerInput,
  WorkspaceKnowledgePrepareWorkerResult,
  WorkspaceKnowledgeSplitSnapshot
} from '../types'

const workerModelsPath: string | undefined =
  workerData && typeof workerData === 'object' && typeof workerData.modelsPath === 'string'
    ? workerData.modelsPath
    : undefined

let workerEmbeddingService: EmbeddingService | null = null

const getWorkerEmbeddingService = (): EmbeddingService => {
  if (workerModelsPath) {
    if (!workerEmbeddingService) {
      workerEmbeddingService = new EmbeddingService({ modelsPath: workerModelsPath })
    }
    return workerEmbeddingService
  }
  return EmbeddingService.getInstance()
}

type PreparedSource = {
  filePath: string
  fileExt: string
  contentHash: string
  sourceType: 'file' | 'web'
  splitSnapshot: WorkspaceKnowledgeSplitSnapshot
}

const prepareSplitSnapshot = async (
  input: WorkspaceKnowledgePrepareWorkerInput
): Promise<PreparedSource> => {
  if (input.sourceType === 'web') {
    const fileExt = '.html'
    const splitSnapshot =
      input.cachedSplit ||
      (await buildWorkspaceKnowledgeSplitSnapshotFromText({
        ingestionService: IngestionService.getInstance(),
        url: input.sourceUrl,
        title: input.documentName,
        text: input.rawText,
        contentHash: input.contentHash,
        fileExt
      }))
    return {
      filePath: input.sourceUrl,
      fileExt,
      contentHash: input.contentHash,
      sourceType: 'web',
      splitSnapshot
    }
  }

  if (!isSupportedLocalFilePath(input.filePath)) {
    throw new Error(`Unsupported file type: ${input.filePath}`)
  }
  const contentHash = await computeWorkspaceFileContentHash(input.filePath)
  const fileExt = path.extname(input.filePath).toLowerCase()
  const splitSnapshot =
    input.cachedSplit ||
    (await buildWorkspaceKnowledgeSplitSnapshot({
      ingestionService: IngestionService.getInstance(),
      filePath: input.filePath,
      contentHash,
      fileExt
    }))
  return { filePath: input.filePath, fileExt, contentHash, sourceType: 'file', splitSnapshot }
}

export const handleWorkspaceIndexWorkerRequest = async (
  request: WorkspaceIndexWorkerRequest
): Promise<WorkspaceIndexWorkerResponse> => {
  try {
    if (request.action !== 'prepare_file') {
      throw new Error(`unsupported workspace index worker action: ${request.action}`)
    }

    const input = request.payload
    const { filePath, fileExt, contentHash, sourceType, splitSnapshot } =
      await prepareSplitSnapshot(input)

    const hasUsableCachedVectors =
      Boolean(input.cachedVectors) &&
      input.cachedVectors?.vectors.length === splitSnapshot.chunks.length
    let vectorSnapshot = input.cachedVectors
    if (!hasUsableCachedVectors || !vectorSnapshot) {
      if (splitSnapshot.chunks.length === 0) {
        vectorSnapshot = {
          contentHash,
          fileExt,
          modelName: getWorkerEmbeddingService().getModelName(),
          vectors: []
        }
      } else {
        const embeddingService = getWorkerEmbeddingService()
        if (embeddingService.getStatus() !== 'ready') {
          await embeddingService.initialize()
        }
        if (embeddingService.getStatus() !== 'ready') {
          throw new Error(
            `EmbeddingService is not ready in workspace index worker. Current status: ${embeddingService.getStatus()}`
          )
        }
        vectorSnapshot = {
          contentHash,
          fileExt,
          modelName: embeddingService.getModelName(),
          vectors: (
            await buildWorkspaceKnowledgeVectors({
              embeddingService,
              chunks: splitSnapshot.chunks
            })
          ).vectors
        }
      }
    }

    const payload: WorkspaceKnowledgePrepareWorkerResult = {
      documentId: input.documentId,
      filePath,
      fileExt,
      documentName: input.documentName,
      contentHash,
      chunkCount: splitSnapshot.chunks.length,
      splitSnapshot,
      vectorSnapshot,
      chunks: buildWorkspaceKnowledgeChunks({
        workspaceId: input.workspaceId,
        documentId: input.documentId,
        documentName: input.documentName,
        contentHash,
        sourceType,
        chunks: splitSnapshot.chunks
      })
    }

    return {
      requestId: request.requestId,
      ok: true,
      payload
    }
  } catch (error) {
    return {
      requestId: request.requestId,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

const workspaceIndexWorkerParentPort = parentPort

if (workspaceIndexWorkerParentPort) {
  workspaceIndexWorkerParentPort.on('message', (request: WorkspaceIndexWorkerRequest) => {
    void handleWorkspaceIndexWorkerRequest(request)
      .then((response) => workspaceIndexWorkerParentPort.postMessage(response))
      .catch((error) =>
        workspaceIndexWorkerParentPort.postMessage({
          requestId: request.requestId,
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        } satisfies WorkspaceIndexWorkerResponse)
      )
  })
}
