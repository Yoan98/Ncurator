import { describe, it } from 'vitest'
import type { WorkspaceIndexJobRecord } from '../../../../../src/shared/types'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

const NOW = 1_716_200_000_000

const createJob = (input: {
  id: string
  sourceKind: WorkspaceIndexJobRecord['source_kind']
  status?: WorkspaceIndexJobRecord['status']
  startedAt?: number
}): WorkspaceIndexJobRecord => ({
  id: input.id,
  workspace_id: 'workspace-index-job-store-contract',
  source_kind: input.sourceKind,
  action: 'prepare',
  status: input.status || 'running',
  phase: input.sourceKind === 'web' ? 'crawl' : 'index',
  step_index: input.sourceKind === 'web' ? 1 : 1,
  step_total: input.sourceKind === 'web' ? 2 : 1,
  total_count: 3,
  processed_count: 0,
  failed_count: 0,
  target_ids: ['target-a', 'target-b', 'target-c'],
  message: 'running',
  started_at: input.startedAt || NOW,
  updated_at: input.startedAt || NOW
})

describe('unit workspace backend', () => {
  it('workspace-index-job-store-contract', async () => {
    await runBackendCase({
      caseId: 'workspace-index-job-store-contract',
      harnessMode: 'tool-real',
      domain: 'unit',
      suite: 'workspace',
      groups: ['files'],
      description: 'workspace_index_job store 支持创建、active 查询、阶段进度更新和失败收敛。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const olderJob = createJob({
          id: 'older-running-file-job',
          sourceKind: 'file',
          startedAt: NOW
        })
        const newerJob = createJob({
          id: 'newer-running-file-job',
          sourceKind: 'file',
          startedAt: NOW + 1
        })
        const webJob = createJob({
          id: 'running-web-job',
          sourceKind: 'web',
          startedAt: NOW + 2
        })
        await runtime.storageService.workspaceIndexJob.saveJob(olderJob)
        await runtime.storageService.workspaceIndexJob.saveJob(newerJob)
        await runtime.storageService.workspaceIndexJob.saveJob(webJob)

        await runtime.storageService.workspaceIndexJob.updateJob(newerJob.id, {
          phase: 'index',
          step_index: 1,
          processed_count: 2,
          failed_count: 1,
          message: '已处理 2/3',
          updated_at: NOW + 3
        })

        const activeFileJob = await runtime.storageService.workspaceIndexJob.getActiveJob(
          olderJob.workspace_id,
          'file'
        )
        const updatedFileJob = await runtime.storageService.workspaceIndexJob.getJobById(
          newerJob.id
        )
        const failedCount = await runtime.storageService.workspaceIndexJob.failRunningJobs(
          '程序关闭导致索引中断',
          NOW + 4
        )
        const runningJobs = await runtime.storageService.workspaceIndexJob.listRunningJobs()
        const failedWebJob = await runtime.storageService.workspaceIndexJob.getJobById(webJob.id)

        return {
          activeFileJob,
          updatedFileJob,
          failedCount,
          runningJobCount: runningJobs.length,
          failedWebJob
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(result.activeFileJob?.id === 'newer-running-file-job', {
          name: 'active-job-returns-latest-running-job',
          message:
            '同一工作区和资料类型存在 running job 时，应以最新 started_at 的任务作为 active job，对齐 SET-WORKSPACE-004-AC3。',
          data: result
        })

        runtime.assertThat(
          result.updatedFileJob?.processed_count === 2 &&
            result.updatedFileJob.failed_count === 1 &&
            result.updatedFileJob.message === '已处理 2/3',
          {
            name: 'job-progress-updates-are-persisted',
            message: 'job 阶段进度更新后应能持久化读取，用于页面恢复，对齐 SET-WORKSPACE-004-AC4。',
            data: result
          }
        )

        runtime.assertThat(
          result.failedCount === 3 &&
            result.runningJobCount === 0 &&
            result.failedWebJob?.last_error === '程序关闭导致索引中断',
          {
            name: 'running-jobs-fail-together',
            message:
              '恢复逻辑应能批量把 running job 收敛为失败，对齐 SET-WORKSPACE-004-AC5、SET-WEB-004-AC6。',
            data: result
          }
        )
      }
    })
  })
})
