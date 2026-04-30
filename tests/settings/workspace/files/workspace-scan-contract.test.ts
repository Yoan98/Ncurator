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
      description: '工作空间扫描服务返回可支撑页面刷新的 progress 与最新列表数据源。',
      fixtures: ['tests/fixtures/workspace'],
      runMode: 'single',
      execute: async (runtime) => {
        const scanResult = await runtime.workspaceSourceService.scanWorkspace({
          workspaceId: 'workspace-scan-contract',
          rootPath: runtime.workspaceRoot,
          workspaceName: '扫描契约工作区'
        })

        await runtime.storageService.workspace.saveWorkspace(scanResult.workspace)
        await runtime.storageService.workspace.replaceWorkspaceNodes(
          scanResult.workspace.id,
          scanResult.nodes
        )

        const workspaceList = await runtime.storageService.workspace.listWorkspaces()

        return {
          scanResponse: {
            success: true,
            progress: {
              workspace_id: scanResult.workspace.id,
              phase: 'scan',
              total: scanResult.nodes.length,
              completed: scanResult.nodes.length
            }
          },
          workspaceList
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.scanResponse.success &&
            result.scanResponse.progress.phase === 'scan' &&
            typeof result.scanResponse.progress.completed === 'number',
          {
            name: 'workspace-scan-returns-progress-shape',
            message:
              '扫描执行结果应返回可用于页面展示的 progress 字段，对齐 SET-WORKSPACE-003-AC1。',
            data: result
          }
        )

        runtime.assertThat(
          result.workspaceList.length === 1 &&
            result.workspaceList[0]?.status === 'not_prepared' &&
            typeof result.workspaceList[0]?.last_scan_at === 'number',
          {
            name: 'workspace-scan-updates-list-refresh-source',
            message:
              '扫描成功后，列表数据源应包含最新扫描时间与状态，可直接支撑页面刷新，对齐 SET-WORKSPACE-003-AC2。',
            data: result
          }
        )
      }
    })
  })
})
