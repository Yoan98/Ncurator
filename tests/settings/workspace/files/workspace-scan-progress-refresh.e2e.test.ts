import { describe, it } from 'vitest'
import { importSelectors } from '../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import {
  SETTINGS_E2E_TIMEOUT_MS,
  createFixtureWorkspace,
  getSettingsLocator,
  navigateToSettingsSection
} from '../../../harness/e2e/settings'

describe('settings workspace e2e', () => {
  it('workspace-scan-progress-refresh', async () => {
    await runE2ECase({
      caseId: 'workspace-scan-progress-refresh',
      domain: 'settings',
      suite: 'workspace',
      groups: ['files'],
      description: '点击先扫描后，页面展示扫描中的状态，并在完成后刷新状态与目录树。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime
        let scanMetaBefore = ''
        let inProgressVisible = false

        await runtime.step({
          name: 'seed-workspace',
          message: '创建一条 E2E fixture 工作空间并进入工作空间设置页。',
          run: async () => {
            await createFixtureWorkspace(page, {
              rootPath: '/tmp/ncurator-e2e-settings-workspace-scan-delay',
              name: '扫描工作区'
            })
            await navigateToSettingsSection(page, 'workspace')
            await getSettingsLocator(page, importSelectors.workspaceQuickScanButton).waitFor({
              state: 'visible'
            })
            scanMetaBefore =
              (await getSettingsLocator(page, importSelectors.workspaceLastScanMeta).textContent()) ||
              ''
          }
        })

        await runtime.step({
          name: 'scan-workspace',
          message: '点击先扫描并等待扫描完成后的刷新状态。',
          run: async () => {
            await getSettingsLocator(page, importSelectors.workspaceQuickScanButton).click()
            await page.waitForFunction(
              (selector) => {
                const host = document.querySelector(selector)
                return host instanceof HTMLElement && host.innerText.includes('扫描中')
              },
              `[data-testid="${importSelectors.workspaceStatus}"]`
            )
            inProgressVisible = true
            await page.waitForFunction(
              (selector) => {
                const host = document.querySelector(selector)
                return host instanceof HTMLElement && host.innerText.includes('待更新')
              },
              `[data-testid="${importSelectors.workspaceStatus}"]`
            )
          }
        })

        const scanMetaAfter =
          (await getSettingsLocator(page, importSelectors.workspaceLastScanMeta).textContent()) || ''
        const statusText =
          (await getSettingsLocator(page, importSelectors.workspaceStatus).textContent()) || ''
        const treeText = (await getSettingsLocator(page, importSelectors.workspaceTree).textContent()) || ''

        return {
          scanMetaBefore,
          scanMetaAfter,
          statusText,
          inProgressVisible,
          treeText
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(
          result.inProgressVisible || result.statusText.includes('待更新'),
          {
            name: 'scan-progress-is-visible',
            message: '扫描执行中，界面应出现明确的进行中状态或进度反馈，对齐 SET-WORKSPACE-003-AC1。',
            data: result
          }
        )

        await runtime.assertThat(
          result.statusText.includes('待更新') &&
            result.scanMetaBefore !== result.scanMetaAfter &&
            result.treeText.includes('brief.txt'),
          {
            name: 'scan-refreshes-status-and-tree',
            message:
              '扫描成功后，最近扫描信息、状态 badge 和目录树应同步刷新，对齐 SET-WORKSPACE-003-AC2。',
            data: result
          }
        )
      }
    })
  }, SETTINGS_E2E_TIMEOUT_MS)
})
