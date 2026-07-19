import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, it } from 'vitest'
import {
  WORKSPACE_EMBEDDING_BATCH_CHUNK_COUNT,
  WORKSPACE_EMBEDDING_BATCH_MAX_CHARS,
  WORKSPACE_EMBEDDING_CHUNK_MAX_CHARS
} from '../../../../../src/main/services/workspace/constants'
import {
  IngestionService,
  isSupportedLocalFilePath
} from '../../../../../src/main/services/ingestion/loader'
import {
  buildWorkspaceKnowledgeSplitSnapshot,
  computeWorkspaceFileContentHash,
  createWorkspaceEmbeddingBatches
} from '../../../../../src/main/services/workspace/utils/knowledge'
import { handleWorkspacePrepareWorkerRequest } from '../../../../../src/main/services/workspace/worker/workspacePrepareWorker'
import { WorkspacePrepareWorkerClient } from '../../../../../src/main/services/workspace/worker/workspacePrepareWorkerClient'
import type { WorkspacePrepareWorkerRequest } from '../../../../../src/main/services/workspace/types'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

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
      fixtures: ['tests/fixtures/workspace'],
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
          createWorkspaceEmbeddingBatches([createChunk(WORKSPACE_EMBEDDING_CHUNK_MAX_CHARS + 1, 1)])
        } catch (error) {
          hardLimitError = error instanceof Error ? error.message : String(error)
        }

        const workerFilePath = path.join(runtime.workspaceRoot, 'cached-worker.docx')
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
        const pdfFilePath = path.join(runtime.workspaceRoot, '学习笔记', '深度学习.pdf')
        const pdfContentHash = await computeWorkspaceFileContentHash(pdfFilePath)
        const pdfSplitSnapshot = await buildWorkspaceKnowledgeSplitSnapshot({
          ingestionService: IngestionService.getInstance(),
          filePath: pdfFilePath,
          contentHash: pdfContentHash,
          fileExt: '.pdf'
        })
        const markdownFilePath = path.join(runtime.workspaceRoot, 'indexed-notes.md')
        await fs.writeFile(
          markdownFilePath,
          [
            '# Indexed Markdown Notes',
            '',
            'Unique markdown vector marker: cedar-md-index-118.',
            '',
            '- searchable markdown item'
          ].join('\n'),
          'utf8'
        )
        const markdownContentHash = await computeWorkspaceFileContentHash(markdownFilePath)
        const markdownSplitSnapshot = await buildWorkspaceKnowledgeSplitSnapshot({
          ingestionService: IngestionService.getInstance(),
          filePath: markdownFilePath,
          contentHash: markdownContentHash,
          fileExt: '.md'
        })
        const textFilePath = path.join(runtime.workspaceRoot, 'indexed-notes.txt')
        await fs.writeFile(
          textFilePath,
          'Unique plain text vector marker: cedar-txt-index-219.\nSecond text line.',
          'utf8'
        )
        const textContentHash = await computeWorkspaceFileContentHash(textFilePath)
        const textSplitSnapshot = await buildWorkspaceKnowledgeSplitSnapshot({
          ingestionService: IngestionService.getInstance(),
          filePath: textFilePath,
          contentHash: textContentHash,
          fileExt: '.txt'
        })
        const legacyDocPath = path.join(runtime.workspaceRoot, 'legacy-readable.doc')
        await fs.copyFile(
          path.resolve('tests/fixtures/legacy-doc/legacy-readable.doc'),
          legacyDocPath
        )
        const legacyDocContentHash = await computeWorkspaceFileContentHash(legacyDocPath)
        const legacyDocSplitSnapshot = await buildWorkspaceKnowledgeSplitSnapshot({
          ingestionService: IngestionService.getInstance(),
          filePath: legacyDocPath,
          contentHash: legacyDocContentHash,
          fileExt: '.doc'
        })
        const markdownWorkerSuccess = await handleWorkspacePrepareWorkerRequest({
          requestId: 'worker-contract-markdown-success',
          action: 'prepare_source',
          payload: {
            filePath: markdownFilePath,
            cachedSplit: markdownSplitSnapshot
          }
        })
        const emptyTextFilePath = path.join(runtime.workspaceRoot, 'empty-notes.txt')
        await fs.writeFile(emptyTextFilePath, ' \n\t', 'utf8')
        const emptyTextWorkerSuccess = await handleWorkspacePrepareWorkerRequest({
          requestId: 'worker-contract-empty-text-success',
          action: 'prepare_source',
          payload: {
            filePath: emptyTextFilePath
          }
        })
        const pdfWorkerSuccess = await handleWorkspacePrepareWorkerRequest({
          requestId: 'worker-contract-pdf-success',
          action: 'prepare_source',
          payload: {
            filePath: pdfFilePath,
            cachedSplit: pdfSplitSnapshot
          }
        })
        const legacyDocWorkerSuccess = await handleWorkspacePrepareWorkerRequest({
          requestId: 'worker-contract-legacy-doc-success',
          action: 'prepare_source',
          payload: {
            filePath: legacyDocPath,
            cachedSplit: legacyDocSplitSnapshot
          }
        })
        const workerFailure = await handleWorkspacePrepareWorkerRequest({
          ...workerRequest,
          requestId: 'worker-contract-error',
          payload: {
            ...workerRequest.payload,
            filePath: path.join(runtime.workspaceRoot, 'unsupported.js')
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
  })
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
          textFileSupport: {
            md: isSupportedLocalFilePath(markdownFilePath),
            markdown: isSupportedLocalFilePath(path.join(runtime.workspaceRoot, 'notes.markdown')),
            txt: isSupportedLocalFilePath(textFilePath),
            doc: isSupportedLocalFilePath(legacyDocPath),
            js: isSupportedLocalFilePath(path.join(runtime.workspaceRoot, 'unsupported.js'))
          },
          markdownSplitSnapshot,
          textSplitSnapshot,
          legacyDocSplitSnapshot,
          markdownWorkerSuccess,
          emptyTextWorkerSuccess,
          workerSuccess,
          pdfWorkerSuccess,
          legacyDocWorkerSuccess,
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
          result.textFileSupport.md &&
            result.textFileSupport.markdown &&
            result.textFileSupport.txt &&
            result.textFileSupport.doc &&
            !result.textFileSupport.js,
          {
            name: 'text-file-extensions-supported-for-index',
            message: 'workspace 文件索引应支持 .md/.markdown/.txt，并继续拒绝无关脚本文件。',
            data: result
          }
        )

        runtime.assertThat(
          result.legacyDocSplitSnapshot.chunks.some((chunk) =>
            chunk.text.includes('Unicode characters')
          ),
          {
            name: 'legacy-doc-file-produces-searchable-split-chunks',
            message: 'legacy .doc should be read by word-extractor and split into index chunks',
            data: result.legacyDocSplitSnapshot
          }
        )

        runtime.assertThat(
          result.markdownSplitSnapshot.chunks.some((chunk) =>
            chunk.text.includes('cedar-md-index-118')
          ) &&
            result.textSplitSnapshot.chunks.some((chunk) =>
              chunk.text.includes('cedar-txt-index-219')
            ),
          {
            name: 'text-files-produce-searchable-split-chunks',
            message: 'md/txt 文本文件应通过 UTF-8 读取进入现有 splitter，生成可检索 chunk。',
            data: result
          }
        )

        runtime.assertThat(
          result.markdownWorkerSuccess.ok &&
            result.markdownWorkerSuccess.payload?.fileExt === '.md' &&
            result.markdownWorkerSuccess.payload.splitSnapshot.chunks.length > 0 &&
            result.markdownWorkerSuccess.payload.splitSnapshot.chunks.some((chunk) =>
              chunk.text.includes('cedar-md-index-118')
            ),
          {
            name: 'worker-markdown-success-uses-text-loader',
            message: 'workspace worker 应能处理 markdown 文件，并返回可写入本地索引的 chunk。',
            data: result
          }
        )

        runtime.assertThat(
          result.emptyTextWorkerSuccess.ok &&
            result.emptyTextWorkerSuccess.payload?.fileExt === '.txt' &&
            result.emptyTextWorkerSuccess.payload.splitSnapshot.chunks.length === 0,
          {
            name: 'empty-text-file-indexes-without-embedding',
            message: '空 md/txt 应收敛为 0 chunk 索引结果，不应因 embedding 未就绪导致文件级失败。',
            data: result
          }
        )

        runtime.assertThat(
          result.workerSuccess.ok &&
            result.workerSuccess.payload?.splitSnapshot.chunks.length === 1,
          {
            name: 'worker-success-returns-main-process-split-payload',
            message: 'worker 成功时只返回 split chunks，向量推理由独立 embedding runtime 负责。',
            data: result
          }
        )

        runtime.assertThat(
          result.pdfWorkerSuccess.ok &&
            result.pdfWorkerSuccess.payload?.fileExt === '.pdf' &&
            result.pdfWorkerSuccess.payload.splitSnapshot.chunks.length > 0 &&
            result.pdfWorkerSuccess.payload.splitSnapshot.chunks.some((chunk) =>
              chunk.text.includes('深度学习')
            ),
          {
            name: 'worker-pdf-success-uses-supported-loader-version',
            message:
              'workspace worker 应能解析共享 workspace fixture 中的 PDF，并返回可写入本地索引的 chunk，对齐 SET-WORKSPACE-004-AC1。',
            data: result
          }
        )

        runtime.assertThat(
          result.legacyDocWorkerSuccess.ok &&
            result.legacyDocWorkerSuccess.payload?.fileExt === '.doc' &&
            result.legacyDocWorkerSuccess.payload.splitSnapshot.chunks.some((chunk) =>
              chunk.text.includes('Unicode characters')
            ),
          {
            name: 'worker-legacy-doc-success-uses-text-loader',
            message: 'workspace worker should index legacy .doc files',
            data: result.legacyDocWorkerSuccess
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
          result.exitError.includes('workspace prepare worker exited with code 1') &&
            result.exitRecovery.contentHash === 'exit-recovery-hash',
          {
            name: 'worker-exit-fails-current-file-and-rebuilds-for-next-file',
            message: 'worker 非 0 退出时应让当前请求失败，并在后续文件请求中重建 worker 继续处理。',
            data: result
          }
        )
      }
    })
  })
})
