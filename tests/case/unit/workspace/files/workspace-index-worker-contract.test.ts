import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import {
  EmbeddingService,
  type EmbeddingExecutor
} from '../../../../../src/main/services/vector/EmbeddingService'
import { estimateEmbeddingTokens } from '../../../../../src/main/services/vector/runtime/embeddingInputBudget'
import { WorkspaceKnowledgePrepareService } from '../../../../../src/main/services/workspace/WorkspaceKnowledgePrepareService'
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
import type {
  WorkspaceKnowledgeCache,
  WorkspaceKnowledgeSplitSnapshot,
  WorkspacePreparedSource,
  WorkspacePrepareWorkerInput,
  WorkspacePrepareWorkerRequest
} from '../../../../../src/main/services/workspace/types'
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
        getIndexIdentity: () => 'local:unit-test',
        prepareDocumentChunks: (input) => input,
        embed: async (texts: string[]) => {
          embedCalls += 1
          notifyFirstBatchStarted()
          await firstBatchGate
          return {
            data: new Float32Array(texts.length * 4),
            dims: [texts.length, 4],
            modelIdentity: 'local:unit-test'
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

  it.each(['file', 'web'] as const)(
    'expands %s chunks for the remote budget while keeping source cache, pages and vectors aligned',
    async (sourceType) => {
      const filePath = path.resolve('tests/fixtures/workspace/human-input.txt')
      const contentHash =
        sourceType === 'file'
          ? await computeWorkspaceFileContentHash(filePath)
          : 'unit-web-long-body'
      const sourceChunks = [
        { text: '第七页正文。é😀ﷺ\n'.repeat(40), page: 7 },
        { text: '第二十三页正文。👩‍💻\n'.repeat(40), page: 23 }
      ]
      const splitSnapshot: WorkspaceKnowledgeSplitSnapshot = {
        contentHash,
        fileExt: sourceType === 'file' ? '.txt' : '.html',
        chunks: sourceChunks
      }
      const originalSplit = structuredClone(splitSnapshot)
      const preparedSource: WorkspacePreparedSource = {
        filePath: sourceType === 'file' ? filePath : 'https://workspace.example.invalid/article',
        fileExt: splitSnapshot.fileExt,
        contentHash,
        sourceType,
        splitSnapshot
      }
      const prepareSource = vi.fn(async (input: WorkspacePrepareWorkerInput) => {
        void input
        return preparedSource
      })
      const cache: WorkspaceKnowledgeCache = {
        withLock: async (_key, action) => action(),
        loadSplitSnapshot: vi.fn(async () => null),
        saveSplitSnapshot: vi.fn(async () => undefined),
        loadVectorSnapshot: vi.fn(async () => null),
        saveVectorSnapshot: vi.fn(async () => undefined)
      }
      type Dependencies = ConstructorParameters<typeof WorkspaceKnowledgePrepareService>[0]
      type Documents = Dependencies['documentsStore']
      const documentsStore = {
        runGenerationWrite: async <T>(operation: () => Promise<T>): Promise<T> => operation(),
        beginDocumentIndexing: vi.fn<Documents['beginDocumentIndexing']>(() => ({
          previousGenerationId: undefined,
          restore: () => true
        })),
        getDocumentById: vi.fn<Documents['getDocumentById']>(async () => null),
        getDocumentByFilePath: vi.fn<Documents['getDocumentByFilePath']>(async () => null),
        addDocument: vi.fn<Documents['addDocument']>(async () => undefined),
        updateDocumentById: vi.fn<Documents['updateDocumentById']>(async () => undefined),
        markDocumentIndexing: vi.fn<Documents['markDocumentIndexing']>(async () => undefined),
        markDocumentIndexFailed: vi.fn<Documents['markDocumentIndexFailed']>(async () => undefined),
        addChunks: vi.fn<Documents['addChunks']>(async () => undefined),
        activateDocumentGeneration: vi.fn<Documents['activateDocumentGeneration']>(
          async () => undefined
        ),
        deleteChunksByGeneration: vi.fn<Documents['deleteChunksByGeneration']>(
          async () => undefined
        )
      }
      const embeddedTexts: string[] = []
      const embeddedVectors: number[][] = []
      const executor: EmbeddingExecutor = {
        initialize: vi.fn(async () => undefined),
        embed: vi.fn(async (texts: string[]) => {
          const vectors = texts.map((text) => {
            embeddedTexts.push(text)
            const vector = [embeddedTexts.length, text.length]
            embeddedVectors.push(vector)
            return vector
          })
          return { data: new Float32Array(vectors.flat()), dims: [texts.length, 2] }
        })
      }
      const embeddingService = new EmbeddingService({ executor })
      await embeddingService.configure({
        executor,
        modelName: 'bge-m3',
        identity: 'remote:workspace-budget-512',
        kind: 'remote',
        maxInputTokens: 512
      })
      const prepareService = new WorkspaceKnowledgePrepareService({
        embeddingService,
        documentsStore: documentsStore as Documents,
        prepareSource
      })
      try {
        const common = {
          workspaceId: 'unit-budget-workspace',
          documentId: 'unit-budget-document',
          documentName: 'long-body',
          cache
        }
        const indexed =
          sourceType === 'file'
            ? await prepareService.indexLocalFile({ ...common, filePath })
            : await prepareService.indexWebText({
                ...common,
                sourceType: 'web',
                sourceUrl: preparedSource.filePath,
                rawText: sourceChunks.map((chunk) => chunk.text).join(''),
                contentHash
              })
        expect(prepareSource).toHaveBeenCalledTimes(1)
        expect(indexed.chunks.length).toBeGreaterThan(sourceChunks.length)
        expect(indexed.chunkCount).toBe(indexed.chunks.length)
        expect(indexed.chunks.map((chunk) => chunk.text)).toEqual(embeddedTexts)
        expect(indexed.chunks.every((chunk) => estimateEmbeddingTokens(chunk.text) <= 496)).toBe(
          true
        )
        for (const chunk of originalSplit.chunks) {
          expect(
            indexed.chunks
              .filter((part) => part.page === chunk.page)
              .map((part) => part.text)
              .join('')
          ).toBe(chunk.text)
        }
        expect(splitSnapshot).toEqual(originalSplit)
        expect(cache.saveSplitSnapshot).toHaveBeenCalledWith(
          originalSplit,
          sourceType === 'file'
            ? path.basename(filePath)
            : `${common.documentName}\n${preparedSource.filePath}`
        )
        const writes = documentsStore.addChunks.mock.calls.map(([input]) => input)
        const storedChunks = writes.flatMap((input) => input.chunks)
        expect(storedChunks.map((chunk) => chunk.text)).toEqual(embeddedTexts)
        expect(storedChunks.map((chunk) => chunk.metadata.page)).toEqual(
          indexed.chunks.map((chunk) => chunk.page)
        )
        expect(storedChunks.every((chunk) => chunk.source_type === sourceType)).toBe(true)
        expect(
          writes.flatMap((input) => input.vectors.map((vector) => Array.from(vector)))
        ).toEqual(embeddedVectors)
        expect(documentsStore.activateDocumentGeneration).toHaveBeenCalledWith(
          expect.objectContaining({
            documentId: common.documentId,
            embeddingIdentity: 'remote:workspace-budget-512',
            dimension: 2
          })
        )
      } finally {
        await embeddingService.close()
      }
    }
  )

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
