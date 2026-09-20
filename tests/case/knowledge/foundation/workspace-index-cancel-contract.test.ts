import { describe, it } from 'vitest'
import { buildKbCapabilityTools, KB_INDEXING_IN_PROGRESS_ERROR } from '../../../../src/main/services/ai/human/tools/kb/retrievalTools'
import type { KnowledgeRetrievalContext } from '../../../../src/main/services/ai/types'
import type { EmbeddingService } from '../../../../src/main/services/vector/EmbeddingService'
import {
  IndexPrepareCancelledError,
  resolveCancelledPrepareJobStatus,
  runCancellablePrepareLoop,
  toFilePreparePreviousSnapshot,
  toWebPreparePreviousSnapshot,
  WorkspaceIndexPrepareController
} from '../../../../src/main/services/workspace/WorkspaceIndexPrepareController'
import { buildWorkspaceKnowledgeVectors } from '../../../../src/main/services/workspace/utils/knowledge'
import type {
  WebSourceRecord,
  WorkspaceFileIndexRecord,
  WorkspaceIndexJobRecord,
  WorkspaceSource
} from '../../../../src/shared/types'
import { runBackendCase } from '../../../harness/backend/run-backend-case'

const NOW = 1_716_300_000_000
const WORKSPACE: WorkspaceSource = {
  id: 'workspace-index-cancel',
  root_path: '/tmp/workspace-index-cancel',
  created_at: NOW,
  updated_at: NOW
}

const createFileRecord = (
  id: string,
  status: WorkspaceFileIndexRecord['index_status'],
  lastError?: string
): WorkspaceFileIndexRecord => ({
  id,
  workspace_id: WORKSPACE.id,
  relative_path: `${id}.txt`,
  absolute_path: `${WORKSPACE.root_path}/${id}.txt`,
  name: `${id}.txt`,
  file_ext: '.txt',
  size: 32,
  mtime_ms: NOW,
  index_status: status,
  last_error: lastError,
  created_at: NOW,
  updated_at: NOW
})

const createWebSource = (
  id: string,
  status: WebSourceRecord['index_status'],
  lastError?: string
): WebSourceRecord => ({
  id,
  identity_kind: 'normalized_url',
  normalized_url: `https://example.com/${id}`,
  url: `https://example.com/${id}`,
  document_id: `${id}-doc`,
  index_status: status,
  last_error: lastError,
  created_at: NOW,
  updated_at: NOW
})

const invokeKbSearch = async (ctx: KnowledgeRetrievalContext): Promise<string> => {
  const tools = buildKbCapabilityTools({ ctx, runId: ctx.runId })
  const tool = tools.find((item) => item.name === 'kb_search')
  if (!tool) throw new Error('missing kb_search')
  return await tool.invoke({ queryText: '合同' }).then(
    () => '',
    (error: unknown) => (error instanceof Error ? error.message : String(error))
  )
}

describe('knowledge foundation', () => {
  it('workspace-index-cancel-contract', async () => {
    await runBackendCase({
      caseId: 'workspace-index-cancel-contract',
      harnessMode: 'tool-real',
      domain: 'knowledge',
      suite: 'foundation',
      description: '取消 prepare 后已完成保留、未完成回退且不失败，后续地址不启动，检索恢复。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const controller = new WorkspaceIndexPrepareController({
          workspaceStore: runtime.storageService.workspace,
          webSourceStore: runtime.storageService.webSource
        })
        await runtime.storageService.workspace.saveWorkspace(WORKSPACE)

        const indexed = createFileRecord('file-indexed', 'indexed')
        const current = createFileRecord('file-current', 'needs_index')
        const pending = createFileRecord('file-pending', 'needs_index')
        const failed = createFileRecord('file-failed', 'failed', 'old-error')
        await runtime.storageService.workspace.replaceWorkspaceFileIndexRecords(WORKSPACE.id, [
          indexed,
          current,
          pending,
          failed
        ])

        controller.beginSession('file')
        const started: string[] = []
        let releaseCurrent: () => void = () => {}
        const currentGate = new Promise<void>((resolve) => {
          releaseCurrent = resolve
        })
        let notifyCurrentStarted: () => void = () => {}
        const currentStarted = new Promise<void>((resolve) => {
          notifyCurrentStarted = resolve
        })
        const loopPromise = runCancellablePrepareLoop({
          items: [current, pending, failed],
          isCancelled: () => controller.isCancelled('file'),
          runItem: async (record) => {
            started.push(record.id)
            controller.rememberFilePrevious(record.id, toFilePreparePreviousSnapshot(record))
            await runtime.storageService.workspace.upsertWorkspaceFileIndexRecords([
              { ...record, index_status: 'indexing', updated_at: Date.now() }
            ])
            if (record.id === 'file-current') {
              notifyCurrentStarted()
              await currentGate
              if (controller.isCancelled('file')) throw new IndexPrepareCancelledError()
            }
            if (controller.isCancelled('file')) throw new IndexPrepareCancelledError()
            await runtime.storageService.workspace.updateWorkspaceFileIndexRecord(record.id, {
              index_status: 'indexed',
              last_error: undefined,
              updated_at: Date.now()
            })
          }
        })
        await currentStarted
        controller.requestCancel('file')
        releaseCurrent()
        const loopResult = await loopPromise
        const revertedFiles = await controller.revertUnfinishedFiles()
        const fileRecords = await runtime.storageService.workspace.listWorkspaceFileIndexRecords(
          WORKSPACE.id
        )

        const crawling = createWebSource('web-crawling', 'crawling')
        const indexing = createWebSource('web-indexing', 'indexing')
        const webIndexed = createWebSource('web-indexed', 'indexed')
        const previousCrawling = toWebPreparePreviousSnapshot({
          index_status: 'needs_index'
        })
        const previousIndexing = toWebPreparePreviousSnapshot({
          index_status: 'index_failed',
          last_error: 'index boom'
        })
        await runtime.storageService.webSource.saveWebSource(crawling)
        await runtime.storageService.webSource.saveWebSource(indexing)
        await runtime.storageService.webSource.saveWebSource(webIndexed)
        controller.beginSession('web')
        controller.rememberWebPrevious(crawling.id, previousCrawling)
        controller.rememberWebPrevious(indexing.id, previousIndexing)
        const revertedWeb = await controller.revertUnfinishedWebSources()
        const webSources = await runtime.storageService.webSource.listWebSources()

        const now = Date.now()
        await runtime.storageService.workspaceIndexJob.saveJob({
          id: 'cancel-prepare-job',
          workspace_id: WORKSPACE.id,
          source_kind: 'file',
          action: 'prepare',
          status: 'cancelled',
          phase: 'complete',
          step_index: 1,
          step_total: 1,
          total_count: 3,
          processed_count: 1,
          failed_count: 0,
          target_ids: [current.id, pending.id, failed.id],
          started_at: now,
          updated_at: now,
          finished_at: now
        } satisfies WorkspaceIndexJobRecord)
        const hasRunningPrepareJob =
          await runtime.storageService.workspaceIndexJob.hasRunningPrepareJob()
        const searchError = await invokeKbSearch(runtime.createAiRunContext())

        controller.beginSession('file')
        controller.requestCancel('file')
        const sequentialCalls: string[] = []
        await Promise.resolve().then(async () => {
          for (const workspaceId of ['ws-a', 'ws-b']) {
            if (controller.isCancelled('file')) break
            sequentialCalls.push(workspaceId)
          }
        })

        const idleController = new WorkspaceIndexPrepareController({
          workspaceStore: runtime.storageService.workspace,
          webSourceStore: runtime.storageService.webSource
        })
        const succeededJob = {
          id: 'already-succeeded-job',
          workspace_id: WORKSPACE.id,
          source_kind: 'file',
          action: 'prepare',
          status: 'succeeded',
          phase: 'complete',
          step_index: 1,
          step_total: 1,
          total_count: 1,
          processed_count: 1,
          failed_count: 0,
          target_ids: [indexed.id],
          started_at: now,
          updated_at: now,
          finished_at: now
        } satisfies WorkspaceIndexJobRecord
        await runtime.storageService.workspaceIndexJob.saveJob(succeededJob)
        idleController.requestCancel('file')
        const storedSucceeded = await runtime.storageService.workspaceIndexJob.getJobById(
          succeededJob.id
        )

        const batchController = new WorkspaceIndexPrepareController({
          workspaceStore: runtime.storageService.workspace,
          webSourceStore: runtime.storageService.webSource
        })
        batchController.beginSession('file')
        const chunks = Array.from({ length: 8 }, (_, index) => ({
          text: `chunk-${index}`,
          page: 1
        }))
        let embedCalls = 0
        let releaseFirstBatch: () => void = () => {}
        const firstBatchGate = new Promise<void>((resolve) => {
          releaseFirstBatch = resolve
        })
        let notifyFirstBatchStarted: () => void = () => {}
        const firstBatchStarted = new Promise<void>((resolve) => {
          notifyFirstBatchStarted = resolve
        })
        const vectorPromise = buildWorkspaceKnowledgeVectors({
          embeddingService: {
            embed: async (texts: string[]) => {
              embedCalls += 1
              if (embedCalls === 1) {
                notifyFirstBatchStarted()
                await firstBatchGate
              }
              return {
                data: new Float32Array(texts.length * 4),
                dims: [texts.length, 4]
              }
            }
          } as EmbeddingService,
          chunks,
          signal: batchController.getSignal('file')
        })
        await firstBatchStarted
        batchController.requestCancel('file')
        releaseFirstBatch()
        let vectorCancelled = false
        try {
          await vectorPromise
        } catch (error) {
          vectorCancelled = error instanceof IndexPrepareCancelledError
        }

        return {
          loopResult,
          started,
          revertedFiles,
          fileRecords: fileRecords.map((record) => ({
            id: record.id,
            status: record.index_status,
            lastError: record.last_error || ''
          })),
          revertedWeb,
          webSources: webSources.map((source) => ({
            id: source.id,
            status: source.index_status,
            lastError: source.last_error || ''
          })),
          hasRunningPrepareJob,
          searchError,
          sequentialCalls,
          storedSucceededStatus: storedSucceeded?.status,
          finishedAllStatus: resolveCancelledPrepareJobStatus({
            unfinishedCount: 0,
            processedCount: 3,
            totalCount: 3,
            failedCount: 0
          }),
          unfinishedStatus: resolveCancelledPrepareJobStatus({
            unfinishedCount: 1,
            processedCount: 2,
            totalCount: 3,
            failedCount: 0
          }),
          embedCalls,
          vectorCancelled
        }
      },
      assert: async (result, runtime) => {
        const byId = Object.fromEntries(result.fileRecords.map((record) => [record.id, record]))
        runtime.assertThat(
          result.loopResult.cancelled === true &&
            result.started.join(',') === 'file-current' &&
            byId['file-indexed']?.status === 'indexed' &&
            byId['file-current']?.status === 'needs_index' &&
            byId['file-pending']?.status === 'needs_index' &&
            byId['file-failed']?.status === 'failed' &&
            byId['file-failed']?.lastError === 'old-error' &&
            result.revertedFiles >= 1,
          {
            name: 'cancel-keeps-completed-and-reverts-unfinished',
            message:
              '取消后已完成保留，未完成回退为可索引或原失败，当前未写完的不落成已索引，对齐 SET-WORKSPACE-004-AC14、SET-WORKSPACE-004-AC16。',
            data: result
          }
        )

        runtime.assertThat(result.sequentialCalls.length === 0, {
          name: 'cancel-blocks-remaining-addresses',
          message: '取消后后续地址不得 kickoff，对齐 SET-WORKSPACE-004-AC15。',
          data: result
        })

        const webById = Object.fromEntries(result.webSources.map((source) => [source.id, source]))
        runtime.assertThat(
          result.revertedWeb === 2 &&
            webById['web-crawling']?.status === 'needs_index' &&
            webById['web-indexing']?.status === 'index_failed' &&
            webById['web-indexing']?.lastError === 'index boom' &&
            webById['web-indexed']?.status === 'indexed',
          {
            name: 'web-cancel-reverts-running-sources',
            message:
              '网页执行中条目回到进入本轮前状态，已完成保留，对齐 SET-WEB-004-AC12、SET-WEB-004-AC13。',
            data: result
          }
        )

        runtime.assertThat(
          result.hasRunningPrepareJob === false &&
            result.searchError !== KB_INDEXING_IN_PROGRESS_ERROR,
          {
            name: 'cancel-unblocks-kb-search',
            message:
              'cancelled 后不再拦截知识库检索，对齐 SET-WORKSPACE-004-AC9、SET-WEB-004-AC8。',
            data: result
          }
        )

        runtime.assertThat(
          result.embedCalls === 1 && result.vectorCancelled === true,
          {
            name: 'cancel-stops-after-current-embedding-batch',
            message:
              '取消后只再完成当前嵌入批次，不得继续该文件剩余批次，对齐 SET-WORKSPACE-004-AC16。',
            data: result
          }
        )

        runtime.assertThat(
          result.storedSucceededStatus === 'succeeded' &&
            result.finishedAllStatus === 'succeeded' &&
            result.unfinishedStatus === 'cancelled',
          {
            name: 'cancel-after-complete-keeps-succeeded',
            message:
              '任务已全部完成后取消不得改成 cancelled，对齐 SET-WORKSPACE-004-AC17。',
            data: result
          }
        )
      }
    })
  })
})
