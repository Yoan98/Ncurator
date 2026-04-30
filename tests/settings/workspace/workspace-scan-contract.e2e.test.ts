import { describe, it } from 'vitest'
import { runE2ECase } from '../../harness/e2e/run-e2e-case'
import {
  SETTINGS_E2E_TIMEOUT_MS,
  createFixtureWorkspace
} from '../../harness/e2e/settings'

describe('settings workspace e2e', () => {
  it('workspace-scan-contract', async () => {
    await runE2ECase({
      caseId: 'workspace-scan-contract',
      domain: 'settings',
      suite: 'workspace',
      description: '工作空间扫描接口会返回可用于页面刷新的 progress 载荷。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime
        const workspace = await createFixtureWorkspace(page, {
          rootPath: '/tmp/settings-workspace-scan-contract',
          name: '扫描契约工作区'
        })

        const scanResponse = await page.evaluate(async (workspaceId: string) => {
          return await window.api.workspaceScan({ workspaceId })
        }, workspace.workspace!.id)

        const workspaceList = await page.evaluate(async () => {
          return await window.api.workspaceList()
        })

        return {
          scanResponse,
          workspaceList
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(
          result.scanResponse.success &&
            result.scanResponse.progress?.phase === 'scan' &&
            typeof result.scanResponse.progress?.completed === 'number',
          {
            name: 'workspace-scan-returns-progress-shape',
            message:
              '扫描执行结果应返回可用于页面展示的 progress 字段，对齐 SET-WORKSPACE-003-AC1。',
            data: result
          }
        )

        await runtime.assertThat(
          result.workspaceList.items.length === 1 &&
            result.workspaceList.items[0]?.status === 'stale' &&
            typeof result.workspaceList.items[0]?.last_scan_at === 'number',
          {
            name: 'workspace-scan-updates-list-refresh-source',
            message:
              '扫描成功后，列表数据源应包含最新扫描时间与状态，可直接支撑页面刷新，对齐 SET-WORKSPACE-003-AC2。',
            data: result
          }
        )
      }
    })
  }, SETTINGS_E2E_TIMEOUT_MS)
})
