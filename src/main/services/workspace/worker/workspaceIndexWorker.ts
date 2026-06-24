import { parentPort } from 'node:worker_threads'
import path from 'node:path'
import { IngestionService, isSupportedLocalFilePath } from '../../ingestion/loader'
import { EmbeddingService } from '../../vector/EmbeddingService'
import {
  buildWorkspaceKnowledgeChunks,
  buildWorkspaceKnowledgeSplitSnapshot,
  buildWorkspaceKnowledgeVectors,
  computeWorkspaceFileContentHash
} from '../utils/knowledge'
import type {
  WorkspaceIndexWorkerRequest,
  WorkspaceIndexWorkerResponse,
  WorkspaceKnowledgePrepareWorkerResult
} from '../types'

export const handleWorkspaceIndexWorkerRequest = async (
  request: WorkspaceIndexWorkerRequest
): Promise<WorkspaceIndexWorkerResponse> => {
  try {
    if (request.action !== 'prepare_file') {
      throw new Error(`unsupported workspace index worker action: ${request.action}`)
    }

    const input = request.payload
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

    const hasUsableCachedVectors =
      Boolean(input.cachedVectors) &&
      input.cachedVectors?.vectors.length === splitSnapshot.chunks.length
    let vectorSnapshot = input.cachedVectors
    if (!hasUsableCachedVectors || !vectorSnapshot) {
      if (splitSnapshot.chunks.length === 0) {
        vectorSnapshot = {
          contentHash,
          fileExt,
          modelName: EmbeddingService.getInstance().getModelName(),
          vectors: []
        }
      } else {
        const embeddingService = EmbeddingService.getInstance()
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
      filePath: input.filePath,
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
