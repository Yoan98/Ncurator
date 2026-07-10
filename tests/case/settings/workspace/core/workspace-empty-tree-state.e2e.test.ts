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
  it('workspace-empty-tree-state', async () => {
    await runE2ECase({
      caseId: 'workspace-empty-tree-state',
      domain: 'settings',
      suite: 'workspace',
      groups: ['core'],
      description: '没有工作空间和空工作空间详情都能通过真实 UI 呈现明确空态。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime

        await runtime.step({
          name: 'show-no-workspace-empty-state',
          message: '进入工作空间页，确认无工作空间时左侧和详情区都有空态。',
          run: async () => {
            await navigateToSettingsSection(page, 'workspace')
            await getSettingsLocator(page, importSelectors.workspaceEmptyState).waitFor({
              state: 'visible'
            })
            await page.getByText('选择一个工作空间').waitFor({ state: 'visible' })
          }
        })

        const noWorkspaceListVisible = await getSettingsLocator(
          page,
          importSelectors.workspaceEmptyState
        ).isVisible()
        const noWorkspaceDetailPromptVisible = await page.getByText('选择一个工作空间').isVisible()

        await runtime.step({
          name: 'show-empty-tree-state',
          message: '通过 UI 创建一个未绑定目录工作空间，确认文件 tab 显示空目录提示。',
          run: async () => {
            await createFixtureWorkspace(page, { name: '空目录工作空间' })
            await page.getByText('当前目录没有可显示文件').waitFor({ state: 'visible' })
          }
        })

        return {
          noWorkspaceListVisible,
          noWorkspaceDetailPromptVisible,
          emptyTreeVisible: await page.getByText('当前目录没有可显示文件').isVisible()
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(
          result.noWorkspaceListVisible && result.noWorkspaceDetailPromptVisible,
          {
            name: 'no-workspace-shows-explicit-empty-state',
            message:
              '没有工作空间时，左侧列表和详情区都应呈现明确空态，而不是空白页，对齐 SET-WORKSPACE-007-AC1。',
            data: result
          }
        )

        await runtime.assertThat(result.emptyTreeVisible, {
          name: 'empty-tree-shows-file-empty-state',
          message: '当前目录没有可显示文件时，目录树区域应展示明确空态，对齐 SET-WORKSPACE-007-AC2。',
          data: result
        })
      }
    })
  }, SETTINGS_E2E_TIMEOUT_MS)
})
