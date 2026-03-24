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
      'settings should expose Workspace as the formal local-source entry and show both workspace and web-source sections.',
    fixtures: [],
    runMode: 'repeatable',
    execute: async (runtime) => {
      await runtime.step({
        name: 'open-settings-workspace-tab',
        message: '打开设置页的 Workspace 标签',
        run: async () => {
          await openWorkspaceSettings(runtime.page)
          await runtime.page.waitForSelector(`[data-testid="${settingsSelectors.page}"]`)
        }
      })

      const title = await runtime.page.locator('h1').first().innerText()
      const tabSwitchText = await runtime.page
        .locator(`[data-testid="${settingsSelectors.tabSwitch}"]`)
        .innerText()
      const bodyText = await runtime.page.locator('body').innerText()

      await runtime.captureScreenshot({
        name: 'settings-workspace-tab',
        message: 'Workspace 入口页面截图'
      })

      return {
        title,
        tabSwitchText,
        bodyText
      }
    },
    assert: async (result, runtime) => {
      await runtime.assertThat(result.title.includes('Workspace 设置'), {
        name: 'settings-workspace-title',
        message: 'settings should land on the dedicated Workspace settings header',
        data: result
      })

      await runtime.assertThat(
        result.tabSwitchText.includes('Workspace') &&
          result.bodyText.includes('工作空间') &&
          result.bodyText.includes('网页资料'),
        {
          name: 'settings-workspace-sections-visible',
          message: 'the Workspace settings view should expose both local workspaces and web sources in the same entry',
          data: result
        }
      )

      await runtime.assertThat(result.bodyText.includes('唯一的资料配置入口'), {
        name: 'settings-workspace-single-entry-copy',
        message: 'the Workspace page should clearly communicate that it is the single local-source entry',
        data: result
      })
    }
  })
})
