import { describe, it } from 'vitest'
import { settingsSelectors } from '../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import {
  SETTINGS_E2E_TIMEOUT_MS,
  getSettingsLocator,
  navigateToSettingsSection
} from '../../../harness/e2e/settings'

describe('settings system notification e2e', () => {
  it(
    'system-notification-setting-persists',
    async () => {
      await runE2ECase({
        caseId: 'system-notification-setting-persists',
        domain: 'settings',
        suite: 'general',
        description: '通用设置可以关闭和恢复 AI 运行完成时的系统通知。',
        fixtures: [],
        serviceMode: 'real',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          await navigateToSettingsSection(page, 'general')
          const toggle = getSettingsLocator(page, settingsSelectors.systemNotificationsSwitch)
          await toggle.waitFor({ state: 'visible' })
          const initial = await toggle.isChecked()
          await toggle.click()
          await page.waitForTimeout(100)
          const changed = await toggle.isChecked()
          const settingsAfterSave = await page.evaluate(() => window.api.aiRuntimeSettingsGet())
          await toggle.click()
          return { initial, changed, persisted: settingsAfterSave.systemNotificationsEnabled }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.initial === true && result.changed === false && result.persisted === false,
            {
              name: 'system-notification-toggle-persists',
              message: '关闭系统通知后，开关状态和主进程设置应保持关闭。',
              data: result
            }
          )
        }
      })
    },
    SETTINGS_E2E_TIMEOUT_MS
  )
})
