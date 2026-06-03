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

        return {
          progress: {
            workspace_id: scanResult.workspace.id,
            phase: 'inspect' as const,
            total: records.length,
            completed: records.length
          },
          savedWorkspace,
          fileSummary
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.progress.phase === 'inspect' && typeof result.progress.completed === 'number',
          {
            name: 'workspace-scan-returns-progress-shape',
            message:
              '检查目录变化的结果应返回可用于页面展示的 progress 字段，对齐 SET-WORKSPACE-003-AC1。',
            data: result
          }
        )

        runtime.assertThat(
          Boolean(result.savedWorkspace?.root_path) &&
            !('status' in (result.savedWorkspace || {})) &&
            result.fileSummary.file_count === result.progress.total,
          {
            name: 'workspace-scan-derives-summary-from-file-index',
            message:
              '扫描成功后，工作空间本体只保留容器信息，文件数量与需索引摘要由文件索引记录派生，对齐 SET-WORKSPACE-003-AC2、SET-WORKSPACE-005-AC2。',
            data: result
          }
        )
      }
    })
  })
})
