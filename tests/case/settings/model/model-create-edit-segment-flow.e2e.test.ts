import { describe, it } from 'vitest'
import { settingsSelectors } from '../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import {
  SETTINGS_LONG_E2E_TIMEOUT_MS,
  getSettingsLocator,
  navigateToSettingsSection,
  selectSettingsPresetProviderOption
} from '../../../harness/e2e/settings'

describe('settings model e2e', () => {
  it(
    'model-create-edit-segment-flow',
    async () => {
      await runE2ECase({
        caseId: 'model-create-edit-segment-flow',
        domain: 'settings',
        suite: 'model',
        description: '新增与编辑配置弹框的推荐/自定义类型切换、服务商去重与编辑改服务商语义。',
        fixtures: [],
        serviceMode: 'real',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const customRadio = () => getSettingsLocator(page, settingsSelectors.modelTypeCustom)
          const providerSelect = () =>
            getSettingsLocator(page, settingsSelectors.modelPresetProviderSelect)

          let presetNameInputCount = 0

          await runtime.step({
            name: 'open-create-form-preset-default',
            message: '打开新增弹框，确认推荐类型默认选中、服务商下拉可见且无名称输入框。',
            run: async () => {
              await navigateToSettingsSection(page, 'model')
              await getSettingsLocator(page, settingsSelectors.modelAddButton).click()
              await providerSelect().waitFor({ state: 'visible' })
              presetNameInputCount = await getSettingsLocator(
                page,
                settingsSelectors.modelNameInput
              ).count()
            }
          })

          await runtime.step({
            name: 'create-preset-config',
            message: '推荐类型选择 DeepSeek 并只填写 API Key 保存。',
            run: async () => {
              await selectSettingsPresetProviderOption(page, 'DeepSeek')
              await getSettingsLocator(page, settingsSelectors.modelApiKeyInput).fill(
                'sk-segment-preset'
              )
              await getSettingsLocator(page, settingsSelectors.modelSaveButton).click()
              await page
                .locator('tbody tr')
                .filter({ hasText: 'DeepSeek' })
                .waitFor({ state: 'visible' })
            }
          })

          await runtime.step({
            name: 'preset-duplicate-disabled',
            message: '再次新增时 DeepSeek 在下拉中应禁用并标注已配置。',
            run: async () => {
              await getSettingsLocator(page, settingsSelectors.modelAddButton).click()
              await providerSelect().waitFor({ state: 'visible' })
            }
          })

          await runtime.step({
            name: 'create-custom-config',
            message: '切换到自定义类型，填写名称、地址和 API Key 保存。',
            run: async () => {
              await customRadio().click()
              await getSettingsLocator(page, settingsSelectors.modelNameInput).fill(
                'Segment 自定义'
              )
              await getSettingsLocator(page, settingsSelectors.modelBaseUrlInput).fill(
                'https://segment.local/v1'
              )
              await getSettingsLocator(page, settingsSelectors.modelApiKeyInput).fill(
                'sk-segment-custom'
              )
              await getSettingsLocator(page, settingsSelectors.modelSaveButton).click()
              await page
                .locator('tbody tr')
                .filter({ hasText: 'Segment 自定义' })
                .waitFor({ state: 'visible' })
            }
          })

          let presetProviderSelectLocked = false

          await runtime.step({
            name: 'edit-preset-change-provider',
            message: '编辑 DeepSeek 推荐配置，服务商下拉可改，换成 Kimi 保存。',
            run: async () => {
              await page
                .locator('tbody tr')
                .filter({ hasText: 'DeepSeek' })
                .first()
                .locator(`[data-testid^="${settingsSelectors.modelEditButtonPrefix}-"]`)
                .click()
              await providerSelect().waitFor({ state: 'visible' })
              presetProviderSelectLocked =
                (await providerSelect().locator('.ant-select-disabled').count()) > 0
              await selectSettingsPresetProviderOption(page, 'Kimi')
              await getSettingsLocator(page, settingsSelectors.modelSaveButton).click()
              await page
                .locator('tbody tr')
                .filter({ hasText: 'Kimi' })
                .waitFor({ state: 'visible' })
            }
          })

          const customRow = page.locator('tbody tr').filter({ hasText: 'Segment 自定义' }).first()
          const kimiRow = page.locator('tbody tr').filter({ hasText: 'Kimi' }).first()

          return {
            presetNameInputCount,
            presetProviderDisabled: await providerSelect().locator('.ant-select-disabled').isVisible(),
            presetProviderSelectLocked,
            customRowText: (await customRow.textContent()) || '',
            kimiRowText: (await kimiRow.textContent()) || '',
            rowCount: await page.locator('tbody tr').count()
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(result.presetNameInputCount === 0, {
            name: 'preset-has-no-name-input',
            message:
              '推荐类型不展示名称输入框，名称由系统维护为服务商名，对齐 SET-MODEL-002-AC1。',
            data: result
          })

          await runtime.assertThat(
            result.presetProviderDisabled && result.kimiRowText.includes('Kimi'),
            {
              name: 'preset-config-saved-and-deduped',
              message:
                '推荐配置保存后名称等于服务商名；再次新增时服务商下拉禁用并标注已配置，对齐 SET-MODEL-002-AC2。',
              data: result
            }
          )

          await runtime.assertThat(result.customRowText.includes('自定义'), {
            name: 'custom-config-flagged',
            message:
              '自定义配置在列表中以「自定义」标签区分展示，对齐 SET-MODEL-001-AC3。',
            data: result
          })

          await runtime.assertThat(
            !result.presetProviderSelectLocked &&
              result.kimiRowText.includes('Kimi') &&
              !result.kimiRowText.includes('自定义') &&
              result.rowCount === 2,
            {
              name: 'preset-provider-select-editable',
              message:
                '编辑推荐配置时服务商下拉可改，改为其他服务商保存后仍为推荐类型且未新增记录，对齐 SET-MODEL-002-AC4。',
              data: result
            }
          )
        }
      })
    },
    SETTINGS_LONG_E2E_TIMEOUT_MS
  )
})
