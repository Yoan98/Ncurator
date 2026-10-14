import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { EmbeddingService } from '../../../../../src/main/services/vector/EmbeddingService'
import { IndexPrepareCancelledError } from '../../../../../src/main/services/workspace/WorkspaceIndexPrepareController'
import {
  WORKSPACE_EMBEDDING_BATCH_CHUNK_COUNT,
  WORKSPACE_EMBEDDING_BATCH_MAX_CHARS,
  WORKSPACE_EMBEDDING_CHUNK_MAX_CHARS
} from '../../../../../src/main/services/workspace/constants'
import {
  buildWorkspaceKnowledgeVectors,
  computeWorkspaceFileContentHash,
  createWorkspaceEmbeddingBatches
} from '../../../../../src/main/services/workspace/utils/knowledge'
import { handleWorkspacePrepareWorkerRequest } from '../../../../../src/main/services/workspace/worker/workspacePrepareWorker'
import { WorkspacePrepareWorkerClient } from '../../../../../src/main/services/workspace/worker/workspacePrepareWorkerClient'
import type { WorkspacePrepareWorkerRequest } from '../../../../../src/main/services/workspace/types'
import { prepareWorkspacesSequentially } from '../../../../../src/shared/prepareWorkspacesSequentially'
const createChunk = (length: number, page: number) => ({ text: 'x'.repeat(length), page })

describe('workspace worker adapters', () => {
  it('stops after the current embedding batch when its signal is cancelled', async () => {
    const cancellation = new AbortController()
    const chunks = Array.from({ length: WORKSPACE_EMBEDDING_BATCH_CHUNK_COUNT + 1 }, (_, index) =>
      createChunk(10, index + 1)
    )
    let embedCalls = 0
    let releaseFirstBatch: () => void = () => {}
    const firstBatchGate = new Promise<void>((resolve) => {
      releaseFirstBatch = resolve
    })
    let notifyFirstBatchStarted: () => void = () => {}
    const firstBatchStarted = new Promise<void>((resolve) => {
      notifyFirstBatchStarted = resolve
    })
    const vectors = buildWorkspaceKnowledgeVectors({
      embeddingService: {
        embed: async (texts: string[]) => {
          embedCalls += 1
          notifyFirstBatchStarted()
          await firstBatchGate
          return {
            data: new Float32Array(texts.length * 4),
            dims: [texts.length, 4]
          }
        }
      } as EmbeddingService,
      chunks,
      signal: cancellation.signal
    })
    const cancelled = expect(vectors).rejects.toBeInstanceOf(IndexPrepareCancelledError)
    await firstBatchStarted
    cancellation.abort()
    releaseFirstBatch()
    await cancelled
    expect(embedCalls).toBe(1)
  })

  it('does not start remaining addresses after the first result is cancelled', async () => {
    const calls: string[] = []
    const results = await prepareWorkspacesSequentially(
      ['ws-a', 'ws-b', 'ws-c'],
      async (workspaceId) => {
        calls.push(workspaceId)
        return { cancelled: workspaceId === 'ws-a' }
      },
      (result) => !result.cancelled
    )
    expect(calls).toEqual(['ws-a'])
    expect(results).toEqual([{ cancelled: true }])
  })

  it('respects batch count, character budget and oversized chunk boundaries', () => {
    const normalChunks = [
      createChunk(1000, 1),
      createChunk(3000, 2),
      createChunk(4000, 3),
      createChunk(3999, 4),
      createChunk(2, 5),
      createChunk(2, 6)
    ]
    const normalBatches = createWorkspaceEmbeddingBatches(normalChunks)
    const oversizedBatch = createWorkspaceEmbeddingBatches([
      createChunk(WORKSPACE_EMBEDDING_BATCH_MAX_CHARS + 1, 1),
      createChunk(100, 2)
    ])
    let hardLimitError = ''
    try {
      createWorkspaceEmbeddingBatches([createChunk(WORKSPACE_EMBEDDING_CHUNK_MAX_CHARS + 1, 1)])
    } catch (error) {
      hardLimitError = error instanceof Error ? error.message : String(error)
    }

    expect(
      normalBatches.every(
        (batch) =>
          batch.length <= WORKSPACE_EMBEDDING_BATCH_CHUNK_COUNT &&
          batch.reduce((sum, chunk) => sum + chunk.text.length, 0) <=
            WORKSPACE_EMBEDDING_BATCH_MAX_CHARS
      )
    ).toBe(true)
    expect(oversizedBatch[0]).toEqual([createChunk(WORKSPACE_EMBEDDING_BATCH_MAX_CHARS + 1, 1)])
    expect(hardLimitError).toContain('chunk is too large to embed')
  })
  it('accepts a matching cached split and rebuilds a worker after an exit', async () => {
    const root = path.resolve('tests/.tmp')
    await fs.mkdir(root, { recursive: true })
    const workspaceRoot = await fs.mkdtemp(path.join(root, 'worker-adapter-'))
    try {
      const workerFilePath = path.join(workspaceRoot, 'cached-worker.docx')
      await fs.writeFile(workerFilePath, 'cached worker contract file')
      const workerContentHash = await computeWorkspaceFileContentHash(workerFilePath)
      const workerRequest: WorkspacePrepareWorkerRequest = {
        requestId: 'worker-contract-success',
        action: 'prepare_source',
        payload: {
          filePath: workerFilePath,
          cachedSplit: {
            contentHash: workerContentHash,
            fileExt: '.docx',
            chunks: [
              {
                text: 'cached chunk',
                page: 1
              }
            ]
          }
        }
      }
      const workerSuccess = await handleWorkspacePrepareWorkerRequest(workerRequest)
      expect(workerSuccess.ok).toBe(true)
      expect(workerSuccess.payload?.splitSnapshot).toEqual(workerRequest.payload.cachedSplit)
      const exitWorkerPath = path.join(workspaceRoot, 'workspace-exit-worker.js')
      const exitMarkerPath = path.join(workspaceRoot, 'workspace-exit-worker.marker')
      await fs.writeFile(
        exitWorkerPath,
        `
const fs = require('node:fs')
const { parentPort } = require('node:worker_threads')
const markerPath = ${JSON.stringify(exitMarkerPath)}
parentPort.on('message', (request) => {
  if (!fs.existsSync(markerPath)) {
    fs.writeFileSync(markerPath, 'exited')
    process.exit(1)
    return
  }
  parentPort.postMessage({
    requestId: request.requestId,
    action: 'prepare_source',
    ok: true,
    payload: {
      filePath: request.payload.filePath,
      fileExt: '.docx',
      contentHash: 'exit-recovery-hash',
      sourceType: 'file',
      splitSnapshot: {
        contentHash: 'exit-recovery-hash',
        fileExt: '.docx',
        chunks: []
      }
    }
  }, [])
  parentPort.close()
})
`
      )
      const exitClient = new WorkspacePrepareWorkerClient({
        workerUrl: pathToFileURL(exitWorkerPath)
      })
      let exitError = ''
      try {
        await exitClient.prepareSource({
          filePath: workerFilePath
        })
      } catch (error) {
        exitError = error instanceof Error ? error.message : String(error)
      }
      const exitRecovery = await exitClient.prepareSource({
        filePath: workerFilePath
      })
      expect(exitError).toContain('workspace prepare worker exited with code 1')
      expect(exitRecovery.contentHash).toBe('exit-recovery-hash')
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true })
    }
  })
})
