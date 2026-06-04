import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, it } from 'vitest'
import {
  WORKSPACE_EMBEDDING_BATCH_CHUNK_COUNT,
  WORKSPACE_EMBEDDING_BATCH_MAX_CHARS,
  WORKSPACE_EMBEDDING_CHUNK_MAX_CHARS
} from '../../../../src/main/services/workspace/constants'
import { createWorkspaceEmbeddingBatches } from '../../../../src/main/services/workspace/utils/knowledge'
import { handleWorkspaceIndexWorkerRequest } from '../../../../src/main/services/workspace/worker/workspaceIndexWorker'
import { WorkspaceIndexWorkerClient } from '../../../../src/main/services/workspace/worker/workspaceIndexWorkerClient'
import type { WorkspaceIndexWorkerRequest } from '../../../../src/main/services/workspace/types'
import { runBackendCase } from '../../../harness/backend/run-backend-case'

const createChunk = (length: number, page: number): { text: string; page: number } => ({
  text: 'x'.repeat(length),
  page
})

describe('settings workspace backend', () => {
  it('workspace-index-worker-contract', async () => {
    await runBackendCase({
      caseId: 'workspace-index-worker-contract',
      harnessMode: 'tool-real',
      domain: 'settings',
      suite: 'workspace',
      groups: ['files'],
      description: 'workspace 文件索引 worker 协议与 embedding batch 限制保持稳定。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
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
          createWorkspaceEmbeddingBatches([
            createChunk(WORKSPACE_EMBEDDING_CHUNK_MAX_CHARS + 1, 1)
          ])
        } catch (error) {
          hardLimitError = error instanceof Error ? error.message : String(error)
        }

        const workerFilePath = path.join(runtime.workspaceRoot, 'cached-worker.docx')
        await fs.writeFile(workerFilePath, 'cached worker contract file')
        const workerRequest: WorkspaceIndexWorkerRequest = {
          requestId: 'worker-contract-success',
          action: 'prepare_file',
          payload: {
            workspaceId: 'workspace-index-worker-contract',
            documentId: 'worker-contract-document',
            filePath: workerFilePath,
            documentName: 'cached-worker.docx',
            cachedSplit: {
              contentHash: 'cached-hash',
              fileExt: '.docx',
              chunks: [
                {
                  text: 'cached chunk',
                  page: 1
                }
              ]
            },
            cachedVectors: {
              contentHash: 'cached-hash',
              fileExt: '.docx',
              modelName: 'cached-model',
              vectors: [[0.1, 0.2, 0.3]]
            }
          }
        }
        const workerSuccess = await handleWorkspaceIndexWorkerRequest(workerRequest)
        const workerFailure = await handleWorkspaceIndexWorkerRequest({
          ...workerRequest,
          requestId: 'worker-contract-error',
          payload: {
            ...workerRequest.payload,
            filePath: path.join(runtime.workspaceRoot, 'unsupported.txt'),
            documentName: 'unsupported.txt'
          }
        })
        const exitWorkerPath = path.join(runtime.workspaceRoot, 'workspace-exit-worker.js')
        const exitMarkerPath = path.join(runtime.workspaceRoot, 'workspace-exit-worker.marker')
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
    ok: true,
    payload: {
      documentId: request.payload.documentId,
      filePath: request.payload.filePath,
      fileExt: '.docx',
      documentName: request.payload.documentName,
      contentHash: 'exit-recovery-hash',
      chunkCount: 0,
      splitSnapshot: {
        contentHash: 'exit-recovery-hash',
        fileExt: '.docx',
        chunks: []
      },
      vectorSnapshot: {
        contentHash: 'exit-recovery-hash',
        fileExt: '.docx',
        modelName: 'exit-recovery-model',
        vectors: []
      },
      chunks: []
    }
  })
})
`
        )
        const exitClient = new WorkspaceIndexWorkerClient({
          workerUrl: pathToFileURL(exitWorkerPath)
        })
        let exitError = ''
        try {
          await exitClient.prepareFile({
            workspaceId: 'workspace-index-worker-contract',
            documentId: 'exit-worker-document',
            filePath: workerFilePath,
            documentName: 'cached-worker.docx'
          })
        } catch (error) {
          exitError = error instanceof Error ? error.message : String(error)
        }
        const exitRecovery = await exitClient.prepareFile({
          workspaceId: 'workspace-index-worker-contract',
          documentId: 'exit-worker-document-retry',
          filePath: workerFilePath,
          documentName: 'cached-worker.docx'
        })

        return {
          normalBatchSizes: normalBatches.map((batch) => batch.length),
          normalBatchChars: normalBatches.map((batch) =>
            batch.reduce((total, chunk) => total + chunk.text.length, 0)
          ),
          oversizedBatchSizes: oversizedBatch.map((batch) => batch.length),
          oversizedBatchChars: oversizedBatch.map((batch) =>
            batch.reduce((total, chunk) => total + chunk.text.length, 0)
          ),
          hardLimitError,
          workerSuccess,
          workerFailure,
          exitError,
          exitRecovery
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.normalBatchSizes.every((size) => size <= WORKSPACE_EMBEDDING_BATCH_CHUNK_COUNT) &&
            result.normalBatchChars.every((chars) => chars <= WORKSPACE_EMBEDDING_BATCH_MAX_CHARS),
          {
            name: 'embedding-batches-fit-count-and-char-budget',
            message:
              '普通 chunk batch 应同时满足最多 4 个 chunk 和最多 12000 字符，降低单次 embed 内存峰值。',
            data: result
          }
        )

        runtime.assertThat(
          result.oversizedBatchSizes[0] === 1 &&
            result.oversizedBatchChars[0] === WORKSPACE_EMBEDDING_BATCH_MAX_CHARS + 1,
          {
            name: 'single-oversized-chunk-embeds-alone',
            message:
              '单个 chunk 超过 batch 字符预算但未超过硬上限时，应单独组成 batch，而不是截断或与其他 chunk 混合。',
            data: result
          }
        )

        runtime.assertThat(result.hardLimitError.includes('chunk is too large to embed'), {
          name: 'hard-limit-fails-file',
          message: '单个 chunk 超过 40000 字符硬上限时，应抛错并交由文件级失败收敛。',
          data: result
        })

        runtime.assertThat(
          result.workerSuccess.ok &&
            result.workerSuccess.payload?.chunkCount === 1 &&
            result.workerSuccess.payload.vectorSnapshot.vectors.length === 1,
          {
            name: 'worker-success-returns-main-process-persistable-payload',
            message:
              'worker 成功时应返回 split/chunks/vectors，供 main process 后续写 DocumentStore 与 LanceDB。',
            data: result
          }
        )

        runtime.assertThat(
          !result.workerFailure.ok && result.workerFailure.error?.includes('Unsupported file type'),
          {
            name: 'worker-js-error-becomes-file-level-failure-response',
            message:
              'worker 内 JS 错误应返回 ok=false，让 main process 把当前文件收敛为 failed 并继续后续文件。',
            data: result
          }
        )

        runtime.assertThat(
          result.exitError.includes('workspace index worker exited with code 1') &&
            result.exitRecovery.contentHash === 'exit-recovery-hash',
          {
            name: 'worker-exit-fails-current-file-and-rebuilds-for-next-file',
            message:
              'worker 非 0 退出时应让当前请求失败，并在后续文件请求中重建 worker 继续处理。',
            data: result
          }
        )
      }
    })
  })
})
