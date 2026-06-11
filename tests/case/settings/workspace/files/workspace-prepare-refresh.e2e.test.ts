import type { Page } from 'playwright'
import { describe, it } from 'vitest'
import type { WorkspaceTreeListResponse } from '../../../../../src/shared/types'
import { importSelectors } from '../../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  SETTINGS_E2E_TIMEOUT_MS,
  createFixtureWorkspace,
  getSettingsLocator,
  navigateToSettingsSection
} from '../../../../harness/e2e/settings'

const waitForWorkspaceTree = async (
  page: Page,
  workspaceId: string,
  predicate: (response: WorkspaceTreeListResponse) => boolean,
  timeoutMs = 5000
): Promise<WorkspaceTreeListResponse> => {
  const deadline = Date.now() + timeoutMs
  let lastResponse = await page.evaluate(async (selectedWorkspaceId) => {
    return await window.api.workspaceTree({
      workspaceId: String(selectedWorkspaceId || ''),
      includeUnsupported: true
    })
  }, workspaceId)

  while (!predicate(lastResponse)) {
    if (Date.now() >= deadline) return lastResponse
    await page.waitForTimeout(200)
    lastResponse = await page.evaluate(async (selectedWorkspaceId) => {
      return await window.api.workspaceTree({
        workspaceId: String(selectedWorkspaceId || ''),
        includeUnsupported: true
      })
    }, workspaceId)
  }

  return lastResponse
}

describe('settings workspace e2e', () => {
  it('workspace-prepare-refresh', async () => {
    await runE2ECase({
      caseId: 'workspace-prepare-refresh',
      domain: 'settings',
      suite: 'workspace',
      groups: ['files'],
      description: '点击更新索引后，页面按增量策略执行，并在完成后刷新文件索引状态。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime
        let workspaceId = ''
        let prepareProgressVisible = false
        let buttonsDisabled = false

        await runtime.step({
          name: 'seed-workspace',
          message: '创建一条带索引延迟的 fixture 工作空间并进入工作空间页。',
          run: async () => {
            const workspace = await createFixtureWorkspace(page, {
              rootPath: '/tmp/ncurator-e2e-settings-workspace-prepare-delay',
              name: '索引工作区'
            })
            workspaceId = workspace.workspace!.id
            await navigateToSettingsSection(page, 'workspace')
            await getSettingsLocator(page, importSelectors.workspaceQuickPrepareButton).waitFor({
              state: 'visible'
            })
          }
        })

        await runtime.step({
          name: 'prepare-workspace',
          message: '点击更新索引并等待文件状态转为已索引。',
          run: async () => {
            await getSettingsLocator(page, importSelectors.workspaceQuickPrepareButton).click()
            await getSettingsLocator(page, importSelectors.workspaceIndexJobProgress).waitFor({
              state: 'visible'
            })
            prepareProgressVisible = true
            buttonsDisabled =
              (await getSettingsLocator(page, importSelectors.workspaceQuickScanButton).isDisabled()) &&
              (await getSettingsLocator(page, importSelectors.workspaceQuickPrepareButton).isDisabled())
          }
        })
        const treeResponse = await waitForWorkspaceTree(
          page,
          workspaceId,
          (response) =>
            response.summary.indexed_file_count === 1 && response.summary.needs_index_count === 0
        )

        return {
          prepareProgressVisible,
          buttonsDisabled,
          summary: treeResponse.summary,
          fileStatuses: treeResponse.items
            .filter((item) => item.kind === 'file')
            .map((item) => item.index_status || '')
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(result.prepareProgressVisible && result.buttonsDisabled, {
          name: 'prepare-progress-is-visible',
          message: '更新索引执行中，界面应展示持久化总进度并禁用两个索引操作按钮，对齐 SET-WORKSPACE-004-AC3。',
          data: result
        })

        await runtime.assertThat(
          result.summary.indexed_file_count === 1 &&
            result.summary.needs_index_count === 0 &&
            result.fileStatuses.every((status) => status === 'indexed'),
          {
            name: 'prepare-refreshes-index-summary',
            message:
              '更新索引成功后，文件索引摘要和文件节点状态都应同步刷新，对齐 SET-WORKSPACE-004-AC2。',
            data: result
          }
        )
      }
    })
  }, SETTINGS_E2E_TIMEOUT_MS)
})
