import { describe, it } from 'vitest'
import { importSelectors } from '../../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  SETTINGS_E2E_TIMEOUT_MS,
  createFixtureWorkspace,
  getSettingsLocator,
  navigateToSettingsSection
} from '../../../../harness/e2e/settings'

describe('settings workspace e2e', () => {
  it('workspace-scan-progress-refresh', async () => {
    await runE2ECase({
      caseId: 'workspace-scan-progress-refresh',
      domain: 'settings',
      suite: 'workspace',
      groups: ['files'],
      description: '点击检查更新后，页面展示执行中状态，并在完成后刷新目录树和索引摘要。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime
        let workspaceId = ''
        let inProgressVisible = false
        let buttonsDisabled = false

        await runtime.step({
          name: 'seed-workspace',
          message: '创建一条带扫描延迟的 fixture 工作空间并进入工作空间页。',
          run: async () => {
            const workspace = await createFixtureWorkspace(page, {
              rootPath: '/tmp/ncurator-e2e-settings-workspace-scan-delay',
              name: '扫描工作区'
            })
            workspaceId = workspace.workspace!.id
            await navigateToSettingsSection(page, 'workspace')
            await getSettingsLocator(page, importSelectors.workspaceQuickScanButton).waitFor({
              state: 'visible'
            })
          }
        })

        await runtime.step({
          name: 'scan-workspace',
          message: '点击检查更新并等待接口完成，确认按钮出现执行中状态。',
          run: async () => {
            await getSettingsLocator(page, importSelectors.workspaceQuickScanButton).click()
            await getSettingsLocator(page, importSelectors.workspaceIndexJobProgress).waitFor({
              state: 'visible'
            })
            inProgressVisible = true
            buttonsDisabled =
              (await getSettingsLocator(page, importSelectors.workspaceQuickScanButton).isDisabled()) &&
              (await getSettingsLocator(page, importSelectors.workspaceQuickPrepareButton).isDisabled())
            await page.waitForFunction(async (selectedWorkspaceId) => {
              const response = await window.api.workspaceTree({
                workspaceId: String(selectedWorkspaceId || ''),
                includeUnsupported: true
              })
              return response.summary.needs_index_count === 1 && response.items.length > 0
            }, workspaceId)
          }
        })

        const treeResponse = await page.evaluate(async (selectedWorkspaceId) => {
          return await window.api.workspaceTree({
            workspaceId: String(selectedWorkspaceId || ''),
            includeUnsupported: true
          })
        }, workspaceId)

        return {
          inProgressVisible,
          buttonsDisabled,
          summary: treeResponse.summary,
          itemNames: treeResponse.items.map((item) => item.name)
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(result.inProgressVisible && result.buttonsDisabled, {
          name: 'scan-progress-is-visible',
          message: '检查更新执行中，界面应展示持久化进度并禁用两个索引操作按钮，对齐 SET-WORKSPACE-003-AC1。',
          data: result
        })

        await runtime.assertThat(
          result.summary.file_count === 1 &&
            result.summary.needs_index_count === 1 &&
            result.itemNames.includes('brief.txt'),
          {
            name: 'scan-refreshes-summary-and-tree',
            message:
              '检查成功后，文件索引摘要和目录树内容都应同步刷新，对齐 SET-WORKSPACE-003-AC2。',
            data: result
          }
        )
      }
    })
  }, SETTINGS_E2E_TIMEOUT_MS)
})
