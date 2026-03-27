import { describe, it } from 'vitest'
import { importSelectors } from '../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../harness/e2e/run-e2e-case'
import {
  createFixtureWorkspace,
  getSettingsLocator,
  navigateToSettingsSection
} from '../../harness/e2e/settings'

describe('settings workspace e2e', () => {
  it('workspace-load-by-mode', async () => {
    await runE2ECase({
      caseId: 'workspace-load-by-mode',
      domain: 'settings',
      suite: 'workspace',
      description: '切换加载模式并开始加载后，页面按选中模式请求并刷新加载结果。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime

        await runtime.step({
          name: 'seed-workspace',
          message: '创建待加载工作空间并打开工作空间设置页。',
          run: async () => {
            await createFixtureWorkspace(page, {
              rootPath: '/tmp/ncurator-e2e-settings-workspace-load',
              name: '加载工作区'
            })
            await navigateToSettingsSection(page, 'workspace')
            await getSettingsLocator(page, importSelectors.workspaceQuickPrepareButton).waitFor({
              state: 'visible'
            })
          }
        })

        await runtime.step({
          name: 'prepare-by-presence-only',
          message: '切换到“新变更”模式并执行加载。',
          run: async () => {
            await page.locator('.ant-segmented-item').nth(1).click()
            await page.waitForFunction(() => {
              const selected = document.querySelector('.ant-segmented-item-selected')
              return selected instanceof HTMLElement && selected.innerText.includes('新变更')
            })
            await getSettingsLocator(page, importSelectors.workspaceQuickPrepareButton).click()
            await page.waitForFunction(
              (selector) => {
                const host = document.querySelector(selector)
                return host instanceof HTMLElement && host.innerText.includes('已加载')
              },
              `[data-testid="${importSelectors.workspaceStatus}"]`
            )
          }
        })

        const signals = await runtime.collectSignals()

        return {
          ipcNames: signals.ipcInvokeEntries.map((entry) => entry.name),
          statusText:
            (await getSettingsLocator(page, importSelectors.workspaceStatus).textContent()) || '',
          lastPrepareText:
            (await getSettingsLocator(page, importSelectors.workspaceLastPrepareMeta).textContent()) ||
            '',
          preparedSummaryText:
            (await getSettingsLocator(page, importSelectors.workspaceSummaryPrepared).textContent()) ||
            '',
          pendingSummaryText:
            (await getSettingsLocator(page, importSelectors.workspaceSummaryPending).textContent()) ||
            ''
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(result.ipcNames.includes('workspacePrepare:presence_only'), {
          name: 'selected-mode-enters-prepare-request',
          message: '当前选中的加载模式应进入实际加载请求，而不是只停留在界面展示，对齐 SET-WORKSPACE-004-AC1。',
          data: result
        })

        await runtime.assertThat(
          result.statusText.includes('已加载') &&
            !result.lastPrepareText.includes('未执行') &&
            result.preparedSummaryText.includes('1') &&
            result.pendingSummaryText.includes('0'),
          {
            name: 'prepare-refreshes-summary-and-status',
            message:
              '加载成功后，最近加载时间、摘要统计和状态 badge 应同步刷新，对齐 SET-WORKSPACE-004-AC2。',
            data: result
          }
        )
      }
    })
  })
})
