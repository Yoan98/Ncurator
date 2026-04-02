import { describe, it } from 'vitest'
import { importSelectors } from '../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../harness/e2e/run-e2e-case'
import {
  SETTINGS_E2E_TIMEOUT_MS,
  createFixtureWorkspace,
  getSettingsLocator,
  navigateToSettingsSection
} from '../../harness/e2e/settings'

describe('settings workspace e2e', () => {
  it('workspace-detail-status-and-error', async () => {
    await runE2ECase({
      caseId: 'workspace-detail-status-and-error',
      domain: 'settings',
      suite: 'workspace',
      description: '加载失败后，详情区稳定展示最近错误和摘要统计。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime

        await runtime.step({
          name: 'seed-failing-workspace',
          message: '创建一条 prepare 会失败的 fixture 工作空间，并进入工作空间页。',
          run: async () => {
            await createFixtureWorkspace(page, {
              rootPath: '/tmp/ncurator-e2e-settings-workspace-prepare-fail',
              name: '失败工作区'
            })
            await navigateToSettingsSection(page, 'workspace')
          }
        })

        await runtime.step({
          name: 'trigger-prepare-error',
          message: '点击开始加载，让 fixture 返回失败状态和最近错误。',
          run: async () => {
            await getSettingsLocator(page, importSelectors.workspaceQuickPrepareButton).click()
            await page.waitForFunction(
              (selector) => {
                const host = document.querySelector(selector)
                return host instanceof HTMLElement && host.innerText.includes('失败')
              },
              `[data-testid="${importSelectors.workspaceStatus}"]`
            )
            await page.getByText('E2E fixture prepare failed').waitFor({ state: 'visible' })
          }
        })

        return {
          statusText:
            (await getSettingsLocator(page, importSelectors.workspaceStatus).textContent()) || '',
          lastErrorText:
            (await getSettingsLocator(page, importSelectors.workspaceLastError).textContent()) || '',
          directoriesText:
            (await getSettingsLocator(page, importSelectors.workspaceSummaryDirectories).textContent()) ||
            '',
          filesText:
            (await getSettingsLocator(page, importSelectors.workspaceSummaryFiles).textContent()) || '',
          preparedText:
            (await getSettingsLocator(page, importSelectors.workspaceSummaryPrepared).textContent()) ||
            '',
          pendingText:
            (await getSettingsLocator(page, importSelectors.workspaceSummaryPending).textContent()) ||
            ''
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(
          result.statusText.includes('失败') && result.lastErrorText.includes('E2E fixture prepare failed'),
          {
            name: 'workspace-error-is-visible',
            message: '有错误时，详情区应直接显示最近一次错误，而不是只写到控制台，对齐 SET-WORKSPACE-005-AC1。',
            data: result
          }
        )

        await runtime.assertThat(
          result.directoriesText.includes('1') &&
            result.filesText.includes('1') &&
            result.preparedText.includes('0') &&
            result.pendingText.includes('1'),
          {
            name: 'workspace-summary-remains-visible',
            message: '详情区应始终可见目录数、文件数、已加载数和待处理数，对齐 SET-WORKSPACE-005-AC2。',
            data: result
          }
        )
      }
    })
  }, SETTINGS_E2E_TIMEOUT_MS)
})
