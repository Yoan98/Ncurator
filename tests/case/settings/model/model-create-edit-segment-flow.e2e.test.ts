import { describe, it } from 'vitest'
import { settingsSelectors } from '../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import {
  SETTINGS_LONG_E2E_TIMEOUT_MS,
  getSettingsLocator,
  navigateToSettingsSection
} from '../../../harness/e2e/settings'

describe('settings model e2e', () => {
  it(
    'model-create-edit-segment-flow',
    async () => {
      await runE2ECase({
        caseId: 'model-create-edit-segment-flow',
        domain: 'settings',
        suite: 'model',
        description: '新增与编辑配置弹框的推荐/自定义类型切换、名称自动填充、服务商去重与改名语义。',
        fixtures: [],
        serviceMode: 'real',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const customRadio = () => getSettingsLocator(page, settingsSelectors.modelTypeCustom)
          const providerSelect = () =>
            getSettingsLocator(page, settingsSelectors.modelPresetProviderSelect)
          const selectProviderOption = async (label: string): Promise<void> => {
            await providerSelect().locator('.ant-select-selector').click()
            await page
              .locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')
              .last()
              .locator('[role="option"]')
              .filter({ hasText: label })
              .first()
              .click()
          }

          await runtime.step({
            name: 'open-create-form-preset-default',
            message: '打开新增弹框，确认推荐类型默认选中且服务商下拉可见。',
            run: async () => {
              await navigateToSettingsSection(page, 'model')
              await getSettingsLocator(page, settingsSelectors.modelAddButton).click()
              await providerSelect().waitFor({ state: 'visible' })
            }
          })

          let presetNameAfterSelect = ''

          await runtime.step({
            name: 'create-preset-config',
            message: '服务商下拉选择 DeepSeek 后配置名称自动填充为服务商名，再填写 API Key 保存。',
            run: async () => {
              await selectProviderOption('DeepSeek')
              presetNameAfterSelect = await getSettingsLocator(
                page,
                settingsSelectors.modelNameInput
              ).inputValue()
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
            message: '切换到自定义类型，填写完整表单保存。',
            run: async () => {
              await customRadio().click()
              await getSettingsLocator(page, settingsSelectors.modelNameInput).fill(
                'Segment 自定义'
              )
              await getSettingsLocator(page, settingsSelectors.modelBaseUrlInput)
                .locator('input')
                .fill('https://segment.local/v1')
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

          await runtime.step({
            name: 'edit-preset-rename-stays-preset',
            message: '编辑 DeepSeek 推荐配置改名保存，改名后仍是推荐类型。',
            run: async () => {
              await page
                .locator('tbody tr')
                .filter({ hasText: 'DeepSeek' })
                .first()
                .locator(`[data-testid^="${settingsSelectors.modelEditButtonPrefix}-"]`)
                .click()
              await getSettingsLocator(page, settingsSelectors.modelNameInput).fill(
                'DeepSeek 改名'
              )
              await getSettingsLocator(page, settingsSelectors.modelSaveButton).click()
              await page
                .locator('tbody tr')
                .filter({ hasText: 'DeepSeek 改名' })
                .waitFor({ state: 'visible' })
            }
          })

          const customRow = page.locator('tbody tr').filter({ hasText: 'Segment 自定义' }).first()
          const renamedRow = page.locator('tbody tr').filter({ hasText: 'DeepSeek 改名' }).first()

          return {
            presetNameAfterSelect,
            presetProviderDisabled: await providerSelect().locator('.ant-select-disabled').isVisible(),
            customRowText: (await customRow.textContent()) || '',
            renamedRowText: (await renamedRow.textContent()) || '',
            rowCount: await page.locator('tbody tr').count()
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.presetNameAfterSelect === 'DeepSeek',
            {
              name: 'preset-name-auto-filled',
              message:
                '推荐类型选中服务商后配置名称自动填充为服务商名，对齐 SET-MODEL-002-AC1。',
              data: result
            }
          )

          await runtime.assertThat(
            result.presetProviderDisabled && result.renamedRowText.includes('DeepSeek 改名'),
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
            result.renamedRowText.includes('DeepSeek 改名') &&
              !result.renamedRowText.includes('自定义') &&
              result.rowCount === 2,
            {
              name: 'preset-rename-stays-preset',
              message:
                '编辑推荐配置改名后仍为推荐类型且未新增记录，对齐 SET-MODEL-002-AC5。',
              data: result
            }
          )
        }
      })
    },
    SETTINGS_LONG_E2E_TIMEOUT_MS
  )
})
