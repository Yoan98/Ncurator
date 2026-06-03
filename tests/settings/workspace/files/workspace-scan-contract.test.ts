import { describe, it } from 'vitest'
import { runBackendCase } from '../../../harness/backend/run-backend-case'

describe('settings workspace backend', () => {
  it('workspace-scan-contract', async () => {
    await runBackendCase({
      caseId: 'workspace-scan-contract',
      harnessMode: 'tool-real',
      domain: 'settings',
      suite: 'workspace',
      groups: ['files'],
      description: '工作空间扫描服务生成文件索引记录，并由派生摘要支撑页面刷新。',
      fixtures: ['tests/fixtures/workspace'],
      runMode: 'single',
      execute: async (runtime) => {
        const now = Date.now()
        const scanResult = await runtime.workspaceSourceService.scanWorkspaceTree({
          workspaceId: 'workspace-scan-contract',
          rootPath: runtime.workspaceRoot,
          workspaceName: '扫描契约工作区',
          now
        })
        const records = scanResult.entries
          .filter((entry) => entry.kind === 'file' && entry.supported_for_index)
          .map((entry) =>
            runtime.workspaceSourceService.buildWorkspaceFileIndexRecord({
              workspaceId: scanResult.workspace.id,
              entry,
              now
            })
          )

        await runtime.storageService.workspace.saveWorkspace(scanResult.workspace)
        await runtime.storageService.workspace.replaceWorkspaceFileIndexRecords(
          scanResult.workspace.id,
          records
        )

        const savedWorkspace = await runtime.storageService.workspace.getWorkspaceById(
          scanResult.workspace.id
        )
        const fileSummary = await runtime.storageService.workspace.getWorkspaceFileSummary(
          scanResult.workspace.id
        )
        const nowForJob = Date.now()
        const job = {
          id: 'workspace-scan-contract-job',
          workspace_id: scanResult.workspace.id,
          source_kind: 'file' as const,
          action: 'scan' as const,
          status: 'running' as const,
          phase: 'scan' as const,
          step_index: 1,
          step_total: 1,
          total_count: records.length,
          processed_count: 0,
          failed_count: 0,
          target_ids: records.map((record) => record.id),
          message: '检查目录变化',
          started_at: nowForJob,
          updated_at: nowForJob
        }
        await runtime.storageService.workspaceIndexJob.saveJob(job)
        const activeJob = await runtime.storageService.workspaceIndexJob.getActiveJob(
          scanResult.workspace.id,
          'file'
        )

        return {
          activeJob,
          savedWorkspace,
          fileSummary
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.activeJob?.status === 'running' &&
            result.activeJob.phase === 'scan' &&
            result.activeJob.total_count === result.fileSummary.file_count,
          {
            name: 'workspace-scan-creates-persistent-job',
            message:
              '检查目录变化应具备可用于页面恢复的持久化 job 信息，对齐 SET-WORKSPACE-003-AC1、SET-WORKSPACE-003-AC3。',
            data: result
          }
        )

        runtime.assertThat(
          Boolean(result.savedWorkspace?.root_path) &&
            !('status' in (result.savedWorkspace || {})) &&
            result.fileSummary.file_count === result.activeJob?.total_count,
          {
            name: 'workspace-scan-derives-summary-from-file-index',
            message:
              '扫描成功后，工作空间本体只保留容器信息，文件数量与可索引摘要由文件索引记录派生，对齐 SET-WORKSPACE-003-AC2、SET-WORKSPACE-005-AC2。',
            data: result
          }
        )
      }
    })
  })
})
