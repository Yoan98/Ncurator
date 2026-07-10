import type { Page } from 'playwright'
import { describe, it } from 'vitest'
import { settingsSelectors } from '../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import {
  SETTINGS_E2E_TIMEOUT_MS,
  getSettingsLocator,
  navigateToSettingsSection
} from '../../../harness/e2e/settings'

const fillModelForm = async (page: Page): Promise<void> => {
  await getSettingsLocator(page, settingsSelectors.modelNameInput).fill('公司 OpenAI')
  await getSettingsLocator(page, settingsSelectors.modelBaseUrlInput)
    .locator('input')
    .fill('https://api.openai.com/v1')
  await getSettingsLocator(page, settingsSelectors.modelApiKeyInput).fill('sk-first-config')
}

describe('settings model e2e', () => {
  it(
    'model-first-config-saves-available-service',
    async () => {
      await runE2ECase({
        caseId: 'model-first-config-saves-available-service',
        domain: 'settings',
        suite: 'model',
        description: '配置列表为空时新增第一条连接配置后，会作为可用服务展示。',
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
              await getSettingsLocator(page, settingsSelectors.modelNameInput).waitFor({
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
              await page.locator('tbody tr').filter({ hasText: '公司 OpenAI' }).waitFor({
                state: 'visible'
              })
            }
          })

          const rowText =
            (await page.locator('tbody tr').filter({ hasText: '公司 OpenAI' }).textContent()) || ''

          return { rowText }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.rowText.includes('公司 OpenAI') &&
              result.rowText.includes('https://api.openai.com/v1'),
            {
              name: 'first-config-is-listed-as-service',
              message: '第一条连接配置保存后，应作为可用服务展示，不产生当前/默认状态。',
              data: result
            }
          )
        }
      })
    },
    SETTINGS_E2E_TIMEOUT_MS
  )
})
