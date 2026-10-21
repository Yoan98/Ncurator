import { describe, it } from 'vitest'
import { settingsSelectors } from '../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import {
  SETTINGS_E2E_TIMEOUT_MS,
  getSettingsLocator,
  navigateToSettingsSection
} from '../../../harness/e2e/settings'

describe('settings error log e2e', () => {
  it(
    'error-log-open-directory',
    async () => {
      await runE2ECase({
        caseId: 'error-log-open-directory',
        domain: 'settings',
        suite: 'general',
        description: '通用设置可以打开本地错误日志目录。',
        fixtures: [],
        serviceMode: 'real',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          await navigateToSettingsSection(page, 'general')
          const button = getSettingsLocator(page, settingsSelectors.errorLogOpenDirectoryButton)
          await button.waitFor({ state: 'visible' })
          const panelText = await getSettingsLocator(
            page,
            settingsSelectors.generalPanel
          ).textContent()
          const accessibleName = await button.getAttribute('aria-label')
          await button.click()
          const signals = await runtime.collectSignals()
          return {
            accessibleName,
            buttonText: await button.textContent(),
            panelText,
            calls: signals.ipcInvokeEntries.filter(
              (entry) => entry.name === 'errorLogOpenDirectory'
            )
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.accessibleName === '打开错误日志目录' &&
              result.buttonText?.trim() === '打开' &&
              result.panelText?.includes('日志目录') &&
              result.panelText.includes('app.log') &&
              result.calls.length === 1,
            {
              name: 'error-log-directory-entry',
              message:
                '错误日志入口应展示 app.log 说明并调用打开目录 IPC，对齐 SET-GENERAL-003-AC3。',
              data: result
            }
          )
        }
      })
    },
    SETTINGS_E2E_TIMEOUT_MS
  )
})
