import { describe, it } from 'vitest'
import type {
  WebSourceRecord,
  WorkspaceFileIndexRecord,
  WorkspaceIndexJobRecord,
  WorkspaceSource
} from '../../../../src/shared/types'
import { runBackendCase } from '../../../harness/backend/run-backend-case'

const NOW = 1_716_200_000_000
const WORKSPACE: WorkspaceSource = {
  id: 'workspace-interrupted-job-recovery',
  name: '中断恢复工作区',
  root_path: '/tmp/workspace-interrupted-job-recovery',
  created_at: NOW,
  updated_at: NOW
}

const FILE_RECORD: WorkspaceFileIndexRecord = {
  id: 'interrupted-file-record',
  workspace_id: WORKSPACE.id,
  relative_path: 'docs/interrupted.docx',
  absolute_path: `${WORKSPACE.root_path}/docs/interrupted.docx`,
  name: 'interrupted.docx',
  file_ext: 'docx',
  size: 128,
  mtime_ms: NOW,
  index_status: 'indexing',
  document_id: 'interrupted-file-doc',
  last_checked_at: NOW,
  created_at: NOW,
  updated_at: NOW
}

const createWebSource = (id: string, status: WebSourceRecord['index_status']): WebSourceRecord => ({
  id,
  workspace_id: WORKSPACE.id,
  identity_kind: 'normalized_url',
  normalized_url: `https://example.com/${id}`,
  url: `https://example.com/${id}`,
  document_id: `${id}-doc`,
  index_status: status,
  created_at: NOW,
  updated_at: NOW
})

const createJob = (
  id: string,
  sourceKind: WorkspaceIndexJobRecord['source_kind']
): WorkspaceIndexJobRecord => ({
  id,
  workspace_id: WORKSPACE.id,
  source_kind: sourceKind,
  action: 'prepare',
  status: 'running',
  phase: sourceKind === 'web' ? 'crawl' : 'index',
  step_index: 1,
  step_total: sourceKind === 'web' ? 2 : 1,
  total_count: 1,
  processed_count: 0,
  failed_count: 0,
  target_ids: [],
  started_at: NOW,
  updated_at: NOW
})

describe('unit workspace backend', () => {
  it('workspace-interrupted-job-recovery-contract', async () => {
    await runBackendCase({
      caseId: 'workspace-interrupted-job-recovery-contract',
      harnessMode: 'tool-real',
      domain: 'knowledge',
      suite: 'foundation',
      description: '启动恢复会把遗留 running job 和条目级执行中状态收敛为失败。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await runtime.storageService.workspace.saveWorkspace(WORKSPACE)
        await runtime.storageService.workspace.replaceWorkspaceFileIndexRecords(WORKSPACE.id, [
          FILE_RECORD
        ])
        await runtime.storageService.webSource.saveWebSource(
          createWebSource('crawling-web', 'crawling')
        )
        await runtime.storageService.webSource.saveWebSource(
          createWebSource('indexing-web', 'indexing')
        )
        await runtime.storageService.workspaceIndexJob.saveJob(
          createJob('file-running-job', 'file')
        )
        await runtime.storageService.workspaceIndexJob.saveJob(createJob('web-running-job', 'web'))

        await runtime.storageService.failInterruptedWorkspaceIndexJobs('程序关闭导致索引中断')

        const fileRecords = await runtime.storageService.workspace.listWorkspaceFileIndexRecords(
          WORKSPACE.id
        )
        const webSources = await runtime.storageService.webSource.listWebSources(WORKSPACE.id)
        const runningJobs = await runtime.storageService.workspaceIndexJob.listRunningJobs()
        const fileJob =
          await runtime.storageService.workspaceIndexJob.getJobById('file-running-job')
        const webJob = await runtime.storageService.workspaceIndexJob.getJobById('web-running-job')

        return {
          fileStatuses: fileRecords.map((record) => record.index_status),
          webStatuses: webSources.map((source) => source.index_status),
          runningJobCount: runningJobs.length,
          fileJobStatus: fileJob?.status,
          webJobStatus: webJob?.status,
          fileError: fileRecords[0]?.last_error,
          webErrors: webSources.map((source) => source.last_error)
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.runningJobCount === 0 &&
            result.fileJobStatus === 'failed' &&
            result.webJobStatus === 'failed',
          {
            name: 'running-jobs-fail-on-recovery',
            message:
              '启动恢复应把遗留 running job 标记为失败，对齐 SET-WORKSPACE-004-AC5、SET-WEB-004-AC6。',
            data: result
          }
        )

        runtime.assertThat(
          result.fileStatuses.every((status) => status === 'failed') &&
            result.fileError === '程序关闭导致索引中断',
          {
            name: 'indexing-files-fail-on-recovery',
            message: '启动恢复应把索引中的文件收敛为失败状态，对齐 SET-WORKSPACE-004-AC5。',
            data: result
          }
        )

        runtime.assertThat(
          result.webStatuses.includes('crawl_failed') &&
            result.webStatuses.includes('index_failed') &&
            result.webErrors.every((error) => error === '程序关闭导致索引中断'),
          {
            name: 'running-web-sources-fail-on-recovery',
            message:
              '启动恢复应把爬取中网页收敛为爬取失败、索引中网页收敛为索引失败，对齐 SET-WEB-004-AC6。',
            data: result
          }
        )
      }
    })
  })
})
