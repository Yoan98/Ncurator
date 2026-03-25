import { test } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import { importSelectors } from '../../../../../src/renderer/src/testing/selectors'
import { createFixtureWorkspaceFromSettings, openWorkspaceSettings } from '../../utils/workspaceUi'

test('settings-workspace-empty-and-error-state', async () => {
  await runE2ECase({
    caseId: 'settings-workspace-empty-and-error-state',
    caseType: 'boundary',
    domain: 'workspace',
    layer: 'e2e',
    suite: 'settings',
    groups: ['boundary'],
    description:
      'settings should show a clear empty state first and keep the workspace panel usable after a prepare failure.',
    fixtures: [],
    runMode: 'repeatable',
    execute: async (runtime) => {
      await runtime.step({
        name: 'open-settings-workspace-tab',
        message: '打开 Workspace 设置页并确认空态',
        run: async () => {
          await openWorkspaceSettings(runtime.page)
          await runtime.page.getByTestId(importSelectors.workspaceEmptyState).waitFor()
        }
      })

      const emptyStateText = await runtime.page.getByTestId(importSelectors.workspaceEmptyState).innerText()

      await runtime.step({
        name: 'create-failing-workspace',
        message: '创建一个会在加载阶段失败的 E2E fixture 工作空间',
        run: async () => {
          await createFixtureWorkspaceFromSettings(runtime.page, {
            rootPath: '/tmp/ncurator-e2e-prepare-fail-workspace',
            name: 'E2E 失败工作区'
          })
        }
      })

      await runtime.step({
        name: 'trigger-prepare-failure',
        message: '触发加载失败并等待错误信息可见',
        run: async () => {
          await runtime.page.getByTestId(importSelectors.workspaceQuickPrepareButton).click()
          await runtime.page.getByTestId(importSelectors.workspaceLastError).waitFor()
          await runtime.page.waitForFunction(
            ({ statusTestId, errorTestId }) => {
              const statusNode = document.querySelector(`[data-testid="${statusTestId}"]`)
              const errorNode = document.querySelector(`[data-testid="${errorTestId}"]`)
              return (
                statusNode?.textContent?.includes('失败') &&
                errorNode?.textContent?.includes('E2E fixture prepare failed')
              )
            },
            {
              statusTestId: importSelectors.workspaceStatus,
              errorTestId: importSelectors.workspaceLastError
            }
          )
        }
      })

      const workspaceStatusText = await runtime.page.getByTestId(importSelectors.workspaceStatus).innerText()
      const workspaceErrorText = await runtime.page.getByTestId(importSelectors.workspaceLastError).innerText()
      const detailText = await runtime.page.getByTestId(importSelectors.workspaceDetail).innerText()

      await runtime.captureScreenshot({
        name: 'settings-workspace-empty-and-error-state',
        message: '空态与加载失败后的工作空间设置页截图'
      })

      return {
        emptyStateText,
        workspaceStatusText,
        workspaceErrorText,
        detailText
      }
    },
    assert: async (result, runtime) => {
      await runtime.assertThat(result.emptyStateText.includes('暂无工作空间'), {
        name: 'settings-workspace-empty-state-visible',
        message: 'the Workspace settings page should show a clear empty state before any workspace exists',
        data: result
      })

      await runtime.assertThat(
        result.workspaceStatusText.includes('失败') &&
          result.workspaceErrorText.includes('E2E fixture prepare failed'),
        {
          name: 'settings-workspace-error-state-visible',
          message: 'load failures should surface a visible failed status and an inline error message',
          data: result
        }
      )

      await runtime.assertThat(
        result.detailText.includes('先扫描') &&
          result.detailText.includes('开始加载') &&
          result.detailText.includes('移除'),
        {
          name: 'settings-workspace-error-state-actions-remain-usable',
          message: 'the detail panel should keep retry and removal actions visible after a failure',
          data: result
        }
      )
    }
  })
})
