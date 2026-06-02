import { describe, it } from 'vitest'
import { settingsSelectors } from '../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../harness/e2e/run-e2e-case'
import {
  SETTINGS_E2E_TIMEOUT_MS,
  getSettingsLocator,
  navigateToSettingsSection
} from '../../harness/e2e/settings'

describe('settings model e2e', () => {
  it('model-create-edit-form', async () => {
    await runE2ECase({
      caseId: 'model-create-edit-form',
      domain: 'settings',
      suite: 'model',
      description: '新增和编辑连接配置表单提供模型服务地址、API Key 与必填校验。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime
        let createdConfigId = ''
        let validationBlocked = false

        await runtime.step({
          name: 'open-create-form',
          message: '进入大模型页并打开新增配置弹窗。',
          run: async () => {
            await navigateToSettingsSection(page, 'model')
            await getSettingsLocator(page, settingsSelectors.modelAddButton).click()
            await getSettingsLocator(page, settingsSelectors.modelBaseUrlInput).waitFor({
              state: 'visible'
            })
          }
        })

        await runtime.step({
          name: 'verify-required-validation',
          message: '在空表单上直接保存，确认必填校验阻止提交。',
          run: async () => {
            await getSettingsLocator(page, settingsSelectors.modelSaveButton).click()
            await page.waitForTimeout(300)
            validationBlocked =
              (await page.locator('.ant-form-item-explain-error').count()) >= 2 &&
              (await page.locator('tbody tr').filter({ hasText: 'sk-create-edit' }).count()) === 0
          }
        })

        await runtime.step({
          name: 'create-config',
          message: '填写新增表单并保存一条连接配置。',
          run: async () => {
            await getSettingsLocator(page, settingsSelectors.modelBaseUrlInput)
              .locator('input')
              .fill('https://api.openai.com/v1')
            await getSettingsLocator(page, settingsSelectors.modelApiKeyInput).fill(
              'sk-create-edit'
            )
            await getSettingsLocator(page, settingsSelectors.modelSaveButton).click()
            await page.locator('tbody tr').filter({ hasText: 'https://api.openai.com/v1' }).waitFor({ state: 'visible' })
            createdConfigId = await page.evaluate(async () => {
              const configs = await window.api.llmConfigList()
              const config = configs.find((item) => item.api_key === 'sk-create-edit')
              return config?.id || ''
            })
          }
        })

        await runtime.step({
          name: 'open-edit-form',
          message: '打开刚创建配置的编辑弹窗，检查表单预填。',
          run: async () => {
            await getSettingsLocator(
              page,
              `${settingsSelectors.modelEditButtonPrefix}-${createdConfigId}`
            ).click()
            await getSettingsLocator(page, settingsSelectors.modelBaseUrlInput).waitFor({
              state: 'visible'
            })
          }
        })

        return {
          createFieldVisible:
            (await getSettingsLocator(page, settingsSelectors.modelBaseUrlInput)
              .locator('input')
              .isVisible()) &&
            (await getSettingsLocator(page, settingsSelectors.modelApiKeyInput).isVisible()) &&
            !(await getSettingsLocator(page, settingsSelectors.modelProviderInput).isVisible()),
          validationBlocked,
          editPrefill: {
            baseUrl: await getSettingsLocator(page, settingsSelectors.modelBaseUrlInput)
              .locator('input')
              .inputValue(),
            apiKey: await getSettingsLocator(page, settingsSelectors.modelApiKeyInput).inputValue()
          }
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(result.createFieldVisible, {
          name: 'create-form-shows-required-fields',
          message:
            '新增配置表单应提供模型服务地址和 API Key，并默认隐藏服务商适配类型，对齐 SET-MODEL-002-AC1。',
          data: result
        })

        await runtime.assertThat(result.validationBlocked, {
          name: 'required-validation-blocks-empty-save',
          message: '必填字段为空时保存应被拦截，不能直接提交成功，对齐 SET-MODEL-002-AC3。',
          data: result
        })

        await runtime.assertThat(
          result.editPrefill.baseUrl === 'https://api.openai.com/v1' &&
            result.editPrefill.apiKey === 'sk-create-edit',
          {
            name: 'edit-form-prefills-existing-values',
            message: '编辑现有配置时，表单应带出当前连接信息，而不是打开空表单，对齐 SET-MODEL-002-AC2。',
            data: result
          }
        )
      }
    })
  }, SETTINGS_E2E_TIMEOUT_MS)
})
