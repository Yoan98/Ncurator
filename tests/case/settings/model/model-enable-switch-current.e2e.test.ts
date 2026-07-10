import { describe, it } from 'vitest'
import { settingsSelectors } from '../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import {
  SETTINGS_E2E_TIMEOUT_MS,
  createModelConfigThroughSettingsUi,
  getSettingsLocator,
  navigateToSettingsSection
} from '../../../harness/e2e/settings'

describe('settings model e2e', () => {
  it('model-enable-switch-current', async () => {
    await runE2ECase({
      caseId: 'model-enable-switch-current',
      domain: 'settings',
      suite: 'model',
      description: '启用非当前连接配置后，当前配置标识切换到目标配置。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime

        await runtime.step({
          name: 'create-configs-through-ui',
          message: '通过 UI 创建当前配置和备用配置。',
          run: async () => {
            await createModelConfigThroughSettingsUi(page, {
              baseUrl: 'https://api.openai.com/v1',
              apiKey: 'sk-active-config'
            })
            await createModelConfigThroughSettingsUi(page, {
              baseUrl: 'https://api.deepseek.com/v1',
              apiKey: 'sk-next-config'
            })
          }
        })

        await runtime.step({
          name: 'switch-current-config',
          message: '进入大模型页并启用备用配置。',
          run: async () => {
            await navigateToSettingsSection(page, 'model')
            await page
              .locator('tbody tr')
              .filter({ hasText: 'https://api.deepseek.com/v1' })
              .getByText('启用')
              .click()
            await page.waitForFunction(
              (selector) => {
                const host = document.querySelector(selector)
                return host instanceof HTMLElement && host.innerText.includes('DeepSeek')
              },
              `[data-testid="${settingsSelectors.modelSummaryCurrent}"]`
            )
          }
        })

        const summaryCurrentText =
          (await getSettingsLocator(page, settingsSelectors.modelSummaryCurrent).textContent()) || ''
        const activeRowHasTag = await page
          .locator('tbody tr')
          .filter({ hasText: 'https://api.deepseek.com/v1' })
          .getByText('当前使用')
          .isVisible()
        const previousRowCanActivate = await page
          .locator('tbody tr')
          .filter({ hasText: 'https://api.openai.com/v1' })
          .getByText('启用')
          .isVisible()

        return {
          summaryCurrentText,
          activeRowHasTag,
          previousRowCanActivate
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(
          result.summaryCurrentText.includes('DeepSeek') &&
            result.activeRowHasTag &&
            result.previousRowCanActivate,
          {
            name: 'enable-switches-current-config',
            message:
              '点击“启用”后，目标连接配置应成为当前配置，原激活配置失去当前态并恢复可启用入口，对齐 SET-MODEL-003-AC2。',
            data: result
          }
        )
      }
    })
  }, SETTINGS_E2E_TIMEOUT_MS * 2)
})
