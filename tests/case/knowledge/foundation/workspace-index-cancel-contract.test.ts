import { describe, it } from 'vitest'
import {
  buildKbCapabilityTools,
  KB_INDEXING_IN_PROGRESS_ERROR
} from '../../../../src/main/services/ai/human/tools/kb/retrievalTools'
import type { KnowledgeRetrievalContext } from '../../../../src/main/services/ai/types'
import {
  toFilePreparePreviousSnapshot,
  toWebPreparePreviousSnapshot,
  WorkspaceIndexPrepareController
} from '../../../../src/main/services/workspace/WorkspaceIndexPrepareController'
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
      description: '生产取消控制器与真实 Store 保留完成条目，并将执行中条目回退到原状态。',
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
        const currentFailed = createFileRecord('file-current-failed', 'failed', 'previous-error')
        const pending = createFileRecord('file-pending', 'needs_index')
        const failed = createFileRecord('file-failed', 'failed', 'old-error')
        await runtime.storageService.workspace.replaceWorkspaceFileIndexRecords(WORKSPACE.id, [
          indexed,
          current,
          currentFailed,
          pending,
          failed
        ])

        controller.beginSession('file')
        controller.rememberFilePrevious(
          indexed.id,
          toFilePreparePreviousSnapshot({ index_status: 'needs_index' })
        )
        controller.rememberFilePrevious(current.id, toFilePreparePreviousSnapshot(current))
        controller.rememberFilePrevious(
          currentFailed.id,
          toFilePreparePreviousSnapshot(currentFailed)
        )
        await runtime.storageService.workspace.upsertWorkspaceFileIndexRecords([
          { ...current, index_status: 'indexing', updated_at: Date.now() },
          {
            ...currentFailed,
            index_status: 'indexing',
            last_error: undefined,
            updated_at: Date.now()
          }
        ])
        controller.requestCancel('file')
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
        controller.rememberWebPrevious(
          webIndexed.id,
          toWebPreparePreviousSnapshot({ index_status: 'needs_index' })
        )
        controller.requestCancel('web')
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

        return {
          fileCancelled: controller.isCancelled('file'),
          fileSignalAborted: controller.getSignal('file').aborted,
          webCancelled: controller.isCancelled('web'),
          webSignalAborted: controller.getSignal('web').aborted,
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
          searchError
        }
      },
      assert: async (result, runtime) => {
        const byId = Object.fromEntries(result.fileRecords.map((record) => [record.id, record]))
        runtime.assertThat(
          result.fileCancelled &&
            result.fileSignalAborted &&
            byId['file-indexed']?.status === 'indexed' &&
            byId['file-current']?.status === 'needs_index' &&
            byId['file-current-failed']?.status === 'failed' &&
            byId['file-current-failed']?.lastError === 'previous-error' &&
            byId['file-pending']?.status === 'needs_index' &&
            byId['file-failed']?.status === 'failed' &&
            byId['file-failed']?.lastError === 'old-error' &&
            result.revertedFiles === 2,
          {
            name: 'cancel-keeps-completed-and-reverts-unfinished',
            message:
              '取消控制器回退执行中条目、恢复旧失败与错误，并保留完成条目，补充 SET-WORKSPACE-004-AC14、SET-WORKSPACE-004-AC16 的数据状态证据。',
            data: result
          }
        )

        const webById = Object.fromEntries(result.webSources.map((source) => [source.id, source]))
        runtime.assertThat(
          result.webCancelled &&
            result.webSignalAborted &&
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
              '预置 cancelled job 不再是 running，查询不触发索引拦截，补充 SET-WORKSPACE-004-AC9、SET-WEB-004-AC8。',
            data: result
          }
        )
      }
    })
  })
})
