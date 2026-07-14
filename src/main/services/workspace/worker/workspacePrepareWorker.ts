import { parentPort } from 'node:worker_threads'
import path from 'node:path'
import { IngestionService, isSupportedLocalFilePath } from '../../ingestion/loader'
import {
  buildWorkspaceKnowledgeSplitSnapshot,
  buildWorkspaceKnowledgeSplitSnapshotFromText,
  computeWorkspaceFileContentHash
} from '../utils/knowledge'
import type {
  WorkspacePreparedSource,
  WorkspacePrepareWorkerInput,
  WorkspacePrepareWorkerRequest,
  WorkspacePrepareWorkerResponse
} from '../types'

export const prepareWorkspaceSource = async (
  input: WorkspacePrepareWorkerInput
): Promise<WorkspacePreparedSource> => {
  if (input.sourceType === 'web') {
    const fileExt = '.html'
    const splitSnapshot =
      input.cachedSplit && input.cachedSplit.contentHash === input.contentHash
        ? input.cachedSplit
        : await buildWorkspaceKnowledgeSplitSnapshotFromText({
            ingestionService: IngestionService.getInstance(),
            url: input.sourceUrl,
            title: input.documentName,
            text: input.rawText,
            contentHash: input.contentHash,
            fileExt
          })
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
    input.cachedSplit && input.cachedSplit.contentHash === contentHash
      ? input.cachedSplit
      : await buildWorkspaceKnowledgeSplitSnapshot({
          ingestionService: IngestionService.getInstance(),
          filePath: input.filePath,
          contentHash,
          fileExt
        })
  return { filePath: input.filePath, fileExt, contentHash, sourceType: 'file', splitSnapshot }
}

export const handleWorkspacePrepareWorkerRequest = async (
  request: WorkspacePrepareWorkerRequest
): Promise<WorkspacePrepareWorkerResponse> => {
  try {
    return {
      requestId: request.requestId,
      action: 'prepare_source',
      ok: true,
      payload: await prepareWorkspaceSource(request.payload)
    }
  } catch (error) {
    return {
      requestId: request.requestId,
      action: 'prepare_source',
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

const workspacePrepareWorkerParentPort = parentPort

if (workspacePrepareWorkerParentPort) {
  workspacePrepareWorkerParentPort.on('message', (request: WorkspacePrepareWorkerRequest) => {
    void handleWorkspacePrepareWorkerRequest(request).then((response) =>
      workspacePrepareWorkerParentPort.postMessage(response)
    )
  })
}
