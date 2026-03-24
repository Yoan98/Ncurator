import { test } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import { importSelectors, settingsSelectors } from '../../../../../src/renderer/src/testing/selectors'
import { createFixtureWorkspaceFromSettings, openWorkspaceSettings } from '../../utils/workspaceUi'

test('settings-workspace-create-scan-prepare-flow', async () => {
  await runE2ECase({
    caseId: 'settings-workspace-create-scan-prepare-flow',
    caseType: 'scenario',
    domain: 'workspace',
    layer: 'e2e',
    suite: 'settings',
    groups: ['scenario'],
    description:
      'settings should support creating a workspace, scanning it, preparing it, and then exposing it to source-scope selection.',
    fixtures: [],
    runMode: 'repeatable',
    execute: async (runtime) => {
      const workspaceRoot = '/tmp/ncurator-e2e-import-workspace'

      await runtime.step({
        name: 'open-workspace-settings',
        message: '进入 Workspace 设置页',
        run: async () => {
          await openWorkspaceSettings(runtime.page)
          await runtime.page.waitForSelector(`[data-testid="${settingsSelectors.workspacePanel}"]`)
        }
      })

      await runtime.step({
        name: 'create-workspace',
        message: '通过设置页创建工作空间',
        run: async () => {
          await createFixtureWorkspaceFromSettings(runtime.page, {
            rootPath: workspaceRoot,
            name: 'E2E 导入工作区'
          })
        }
      })

      await runtime.step({
        name: 'scan-workspace',
        message: '触发目录扫描并等待状态刷新为待更新',
        run: async () => {
          await runtime.page.getByTestId(importSelectors.workspaceQuickScanButton).click()
          await runtime.page.getByTestId(importSelectors.workspaceStatus).waitFor({ state: 'visible' })
          await runtime.page.waitForFunction(
            (testId) => {
              const element = document.querySelector(`[data-testid="${testId}"]`)
              return element?.textContent?.includes('待更新')
            },
            importSelectors.workspaceStatus
          )
        }
      })

      await runtime.step({
        name: 'prepare-workspace',
        message: '触发准备并等待状态刷新为已准备',
        run: async () => {
          await runtime.page.getByTestId(importSelectors.workspaceQuickPrepareButton).click()
          await runtime.page.waitForFunction(
            (testId) => {
              const element = document.querySelector(`[data-testid="${testId}"]`)
              return element?.textContent?.includes('已准备')
            },
            importSelectors.workspaceStatus
          )
        }
      })

      const workspaceStatusText = await runtime.page.getByTestId(importSelectors.workspaceStatus).innerText()
      const treeText = await runtime.page.getByTestId(importSelectors.workspaceTree).innerText()
      const searchScopes = await runtime.page.evaluate(async () => {
        return await window.api.sourceScopeList({
          mode: 'search'
        })
      })

      await runtime.captureScreenshot({
        name: 'settings-workspace-create-scan-prepare',
        message: '工作空间创建并准备完成后的设置页截图'
      })

      return {
        workspaceStatusText,
        treeText,
        searchScopes
      }
    },
    assert: async (result, runtime) => {
      await runtime.assertThat(result.workspaceStatusText.includes('已准备'), {
        name: 'settings-workspace-status-after-prepare',
        message: 'the selected workspace should end in the prepared state after scan and prepare complete',
        data: result
      })

      await runtime.assertThat(result.treeText.includes('docs') && result.treeText.includes('brief.txt'), {
        name: 'settings-workspace-tree-after-prepare',
        message: 'the workspace detail pane should show the scanned tree snapshot after create and prepare',
        data: result
      })

      await runtime.assertThat(
        result.searchScopes.items.some((scope) => scope.label === 'E2E 导入工作区'),
        {
          name: 'settings-workspace-enters-source-scope',
          message: 'prepared workspaces created from settings should appear in source-scope selection afterwards',
          data: {
            searchScopes: result.searchScopes,
            settingsPage: `#/settings?tab=workspace`
          }
        }
      )
    }
  })
})
