import { test } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import { settingsSelectors } from '../../../../../src/renderer/src/testing/selectors'
import { openWorkspaceSettings } from '../../utils/workspaceUi'

test('settings-workspace-tab-only-entry', async () => {
  await runE2ECase({
    caseId: 'settings-workspace-tab-only-entry',
    caseType: 'basic',
    domain: 'workspace',
    layer: 'e2e',
    suite: 'settings',
    groups: ['basic'],
    description:
      'settings should expose Workspace as the formal local-source entry while keeping web sources on their own dedicated page.',
    fixtures: [],
    runMode: 'repeatable',
    execute: async (runtime) => {
      await runtime.step({
        name: 'open-settings-workspace-tab',
        message: '打开设置页的工作空间页面',
        run: async () => {
          await openWorkspaceSettings(runtime.page)
          await runtime.page.waitForSelector(`[data-testid="${settingsSelectors.page}"]`)
        }
      })

      const title = await runtime.page.locator('h1').first().innerText()
      const bodyText = await runtime.page.locator('body').innerText()

      await runtime.captureScreenshot({
        name: 'settings-workspace-tab',
        message: 'Workspace 入口页面截图'
      })

      return {
        title,
        bodyText
      }
    },
    assert: async (result, runtime) => {
      await runtime.assertThat(result.title.includes('工作空间'), {
        name: 'settings-workspace-title',
        message: 'settings should land on the dedicated workspace page header',
        data: result
      })

      await runtime.assertThat(
        result.bodyText.includes('工作空间') &&
          result.bodyText.includes('管理本地项目路径、扫描状态和加载操作。') &&
          result.bodyText.includes('添加工作空间') &&
          result.bodyText.includes('选择一个工作空间') &&
          !result.bodyText.includes('来源列表'),
        {
          name: 'settings-workspace-sections-visible',
          message: 'the Workspace settings view should focus on local workspaces only after the split',
          data: result
        }
      )

      await runtime.assertThat(
        result.bodyText.includes('刷新') && result.bodyText.includes('暂无工作空间'),
        {
          name: 'settings-workspace-split-copy',
          message: 'the Workspace page should keep the empty state focused on workspace management',
          data: result
        }
      )
    }
  })
})
