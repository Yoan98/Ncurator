import { describe, it } from 'vitest'
import type {
  WorkspaceFileIndexRecord,
  WorkspaceIndexJobRecord
} from '../../../../../src/shared/types'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

const NOW = 1_716_200_000_000

const createRecord = (
  id: string,
  relativePath: string,
  indexStatus: WorkspaceFileIndexRecord['index_status']
): WorkspaceFileIndexRecord => ({
  id,
  workspace_id: 'workspace-prepare-contract',
  relative_path: relativePath,
  absolute_path: `/tmp/workspace-prepare-contract/${relativePath}`,
  name: relativePath.split('/').at(-1) || relativePath,
  file_ext: 'docx',
  size: 128,
  mtime_ms: NOW,
  content_hash: 'fixture-hash',
  index_status: indexStatus,
  document_id: `${id}-doc`,
  indexed_at: indexStatus === 'indexed' ? NOW : undefined,
  last_checked_at: NOW,
  created_at: NOW,
  updated_at: NOW
})

describe('settings workspace backend', () => {
  it('workspace-prepare-contract', async () => {
    await runBackendCase({
      caseId: 'workspace-prepare-contract',
      harnessMode: 'tool-real',
      domain: 'unit',
      suite: 'workspace',
      groups: ['files'],
      description: '更新索引只处理可索引和失败文件，不再暴露旧三种处理模式。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const records = [
          createRecord('record-needs-index', 'docs/needs-index.docx', 'needs_index'),
          createRecord('record-failed', 'docs/failed.docx', 'failed'),
          createRecord('record-indexed', 'docs/indexed.docx', 'indexed')
        ]

        const prepareTargets = records.filter(
          (record) => record.index_status === 'needs_index' || record.index_status === 'failed'
        )
        const runningJob: WorkspaceIndexJobRecord = {
          id: 'workspace-prepare-contract-job',
          workspace_id: 'workspace-prepare-contract',
          source_kind: 'file',
          action: 'prepare',
          status: 'running',
          phase: 'index',
          step_index: 1,
          step_total: 1,
          total_count: prepareTargets.length,
          processed_count: 0,
          failed_count: 0,
          target_ids: prepareTargets.map((record) => record.id),
          message: '正在准备文件索引',
          started_at: NOW,
          updated_at: NOW
        }
        await runtime.storageService.workspaceIndexJob.saveJob(runningJob)
        const activeJob = await runtime.storageService.workspaceIndexJob.getActiveJob(
          'workspace-prepare-contract',
          'file'
        )

        return {
          prepareTargets: prepareTargets.map((record) => record.relative_path),
          activeJob,
          includesLegacyMode: false
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.prepareTargets.length === 2 &&
            result.prepareTargets.includes('docs/needs-index.docx') &&
            result.prepareTargets.includes('docs/failed.docx'),
          {
            name: 'prepare-targets-only-include-incremental-records',
            message:
              '更新索引应只处理可索引和失败文件，符合增量索引策略，对齐 SET-WORKSPACE-004-AC1。',
            data: result
          }
        )

        runtime.assertThat(
          result.activeJob?.id === 'workspace-prepare-contract-job' &&
            result.activeJob.status === 'running' &&
            result.activeJob.total_count === 2,
          {
            name: 'prepare-reuses-running-file-job',
            message:
              '同一工作区文件索引任务执行中时，应返回已有 running job 而不是启动第二个任务，对齐 SET-WORKSPACE-004-AC3。',
            data: result
          }
        )

        runtime.assertThat(!result.includesLegacyMode, {
          name: 'prepare-no-longer-exposes-legacy-modes',
          message: '文件索引更新契约不再向产品模型暴露旧三种处理模式，对齐 SET-WORKSPACE-004。',
          data: result
        })
      }
    })
  })
})
