import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import { SETTINGS_REAL_WORKSPACE_E2E_TIMEOUT_MS } from '../../../../harness/e2e/settings'
import {
  cleanupRealWorkspace,
  copySharedWorkspaceFixture,
  toSupportedFileStatuses,
  triggerRealWorkspacePrepare
} from './realWorkspaceHelpers'

describe('settings workspace e2e', () => {
  it('workspace-prepare-real-fixture-refresh', async () => {
    await runE2ECase({
      caseId: 'workspace-prepare-real-fixture-refresh',
      domain: 'settings',
      suite: 'workspace',
      groups: ['files'],
      description: '点击更新索引时，真实共享 workspace fixture 的支持文件应进入真实索引链路并完成状态收敛。',
      fixtures: ['tests/fixtures/workspace'],
      launchMode: 'real',
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime
        let workspaceRoot = ''
        try {
          workspaceRoot = await copySharedWorkspaceFixture('workspace-prepare-real-fixture-refresh')
          const result = await runtime.step({
            name: 'prepare-real-workspace',
            message: '创建真实工作空间，绑定共享 workspace fixture 的隔离副本，并点击更新索引。',
            run: async () =>
              await triggerRealWorkspacePrepare(page, {
                workspaceRoot,
                workspaceName: '真实索引工作区'
              })
          })
          const supportedStatuses = toSupportedFileStatuses(result.finalTree)
          return {
            runningJob: result.runningJob,
            lastRunningJob: result.lastRunningJob,
            beforeSummary: result.beforeTree.summary,
            finalSummary: result.finalTree.summary,
            supportedStatuses
          }
        } finally {
          if (workspaceRoot) {
            await cleanupRealWorkspace(workspaceRoot)
          }
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(
          result.supportedStatuses.length >= 12 &&
            result.supportedStatuses.every((item) =>
              item.status === 'indexed' || item.status === 'failed'
            ) &&
            result.finalSummary.indexed_file_count + result.finalSummary.failed_file_count ===
              result.supportedStatuses.length,
          {
            name: 'real-fixture-files-converge',
            message:
              '真实 workspace fixture 中的支持文件应完成索引或失败收敛，摘要应同步刷新，对齐 SET-WORKSPACE-004-AC1、SET-WORKSPACE-004-AC2。',
            data: result
          }
        )
      }
    })
  }, SETTINGS_REAL_WORKSPACE_E2E_TIMEOUT_MS)
})
