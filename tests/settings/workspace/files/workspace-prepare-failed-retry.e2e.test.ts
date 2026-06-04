import { describe, it } from 'vitest'
import { importSelectors } from '../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import {
  SETTINGS_REAL_WORKSPACE_E2E_TIMEOUT_MS,
  createRealWorkspaceWithRoot,
  getSettingsLocator,
  getWorkspaceIndexCounts,
  navigateToSettingsSection,
  waitForFileIndexJobIdle
} from '../../../harness/e2e/settings'
import {
  cleanupRealWorkspace,
  createWorkspaceWithFiles,
  toSupportedFileStatuses
} from './realWorkspaceHelpers'

describe('settings workspace e2e', () => {
  it('workspace-prepare-failed-retry', async () => {
    await runE2ECase({
      caseId: 'workspace-prepare-failed-retry',
      domain: 'settings',
      suite: 'workspace',
      groups: ['files'],
      description: '已有失败文件再次点击更新索引时，应被纳入本次处理范围，且可索引数量包含失败数量。',
      fixtures: [],
      launchMode: 'real',
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime
        let workspaceRoot = ''
        try {
          workspaceRoot = await createWorkspaceWithFiles('workspace-prepare-failed-retry', [
            {
              relativePath: 'broken.docx',
              content: 'not a valid docx archive'
            }
          ])
          const workspace = await createRealWorkspaceWithRoot(page, {
            name: '失败重试工作区',
            rootPath: workspaceRoot
          })
          const workspaceId = workspace.workspace!.id

          await navigateToSettingsSection(page, 'workspace')
          await getSettingsLocator(page, importSelectors.workspaceQuickPrepareButton).waitFor({
            state: 'visible'
          })
          await getSettingsLocator(page, importSelectors.workspaceQuickPrepareButton).click()
          await waitForFileIndexJobIdle(page, workspaceId)
          const firstCounts = await getWorkspaceIndexCounts(page)

          await getSettingsLocator(page, importSelectors.workspaceQuickPrepareButton).click()
          const retry = await waitForFileIndexJobIdle(page, workspaceId)
          const retryCounts = await getWorkspaceIndexCounts(page)

          return {
            firstCounts,
            retryCounts,
            lastRunningJob: retry.lastRunningJob,
            statuses: toSupportedFileStatuses(retry.tree)
          }
        } finally {
          if (workspaceRoot) {
            await cleanupRealWorkspace(workspaceRoot)
          }
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(
          result.firstCounts.actionableCount === 1 && result.firstCounts.failedCount === 1,
          {
            name: 'failed-count-is-actionable',
            message:
              '文件失败后，文件 tab 的可索引数量应包含失败数量，对齐 SET-WORKSPACE-005-AC2。',
            data: result
          }
        )

        await runtime.assertThat(
          result.statuses.length === 1 &&
            result.statuses[0]?.status === 'failed',
          {
            name: 'failed-file-is-retried',
            message:
              '再次更新索引时，已有 failed 文件应再次完成处理并收敛为文件级状态，对齐 SET-WORKSPACE-004-AC1、SET-WORKSPACE-004-AC2。',
            data: result
          }
        )
      }
    })
  }, SETTINGS_REAL_WORKSPACE_E2E_TIMEOUT_MS)
})
