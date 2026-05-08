import type { Page } from 'playwright'
import { describe, it } from 'vitest'
import { settingsSelectors } from '../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../harness/e2e/run-e2e-case'
import {
  SETTINGS_E2E_TIMEOUT_MS,
  getSettingsLocator,
  navigateToSettingsSection
} from '../../harness/e2e/settings'

const fillModelForm = async (page: Page): Promise<void> => {
  await getSettingsLocator(page, settingsSelectors.modelBaseUrlInput)
    .locator('input')
    .fill('https://api.openai.com/v1')
  await getSettingsLocator(page, settingsSelectors.modelApiKeyInput).fill('sk-first-config')
}

describe('settings model e2e', () => {
  it('model-first-config-auto-activate', async () => {
    await runE2ECase({
      caseId: 'model-first-config-auto-activate',
      domain: 'settings',
      suite: 'model',
      description: '配置列表为空时新增第一条连接配置后，会自动成为当前配置。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime

        await runtime.step({
          name: 'open-model-settings',
          message: '进入 Settings 大模型页并打开新增配置弹窗。',
          run: async () => {
            await navigateToSettingsSection(page, 'model')
            await getSettingsLocator(page, settingsSelectors.modelAddButton).click()
            await getSettingsLocator(page, settingsSelectors.modelProviderInput).waitFor({
              state: 'visible'
            })
          }
        })

        await runtime.step({
          name: 'create-first-config',
          message: '填写第一条连接配置并保存。',
          run: async () => {
            await fillModelForm(page)
            await getSettingsLocator(page, settingsSelectors.modelSaveButton).click()
            await page.waitForFunction(
              (selector) => {
                const host = document.querySelector(selector)
                return host instanceof HTMLElement && host.innerText.includes('OpenAI')
              },
              `[data-testid="${settingsSelectors.modelSummaryCurrent}"]`
            )
          }
        })

        const summaryCurrentText =
          (await getSettingsLocator(page, settingsSelectors.modelSummaryCurrent).textContent()) || ''
        const currentRowHasTag = await page
          .locator('tbody tr')
          .filter({ hasText: 'https://api.openai.com/v1' })
          .getByText('当前使用')
          .isVisible()

        return {
          summaryCurrentText,
          currentRowHasTag
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(
          result.summaryCurrentText.includes('OpenAI') && result.currentRowHasTag,
          {
            name: 'first-config-becomes-current',
            message:
              '第一条连接配置保存后，应立即成为当前配置，并在页头摘要和列表行里出现当前态标识，对齐 SET-MODEL-003-AC1。',
            data: result
          }
        )
      }
    })
  }, SETTINGS_E2E_TIMEOUT_MS)
})
