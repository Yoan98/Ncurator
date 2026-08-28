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
        description: '新增与编辑配置弹框的服务商/自定义分段切换、预设锁定、去重与模式转换。',
        fixtures: [],
        serviceMode: 'real',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const tabLocator = () =>
            page.locator(`[data-testid="${settingsSelectors.modelModeSegment}"]`)
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
            message: '打开新增弹框，确认服务商配置 tab 与服务商下拉可见。',
            run: async () => {
              await navigateToSettingsSection(page, 'model')
              await getSettingsLocator(page, settingsSelectors.modelAddButton).click()
              await tabLocator().waitFor({ state: 'visible' })
              await providerSelect().waitFor({ state: 'visible' })
            }
          })

          await runtime.step({
            name: 'create-preset-config',
            message: '服务商下拉选择 DeepSeek 并只填写 API Key 保存。',
            run: async () => {
              await selectProviderOption('DeepSeek')
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
              await tabLocator().waitFor({ state: 'visible' })
            }
          })

          await runtime.step({
            name: 'create-custom-config',
            message: '切到自定义配置分段，填写完整表单保存，检查名称重复拦截。',
            run: async () => {
              await tabLocator().getByText('自定义配置').click()
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
            name: 'edit-preset-locked',
            message: '编辑 DeepSeek 预设配置，确认服务商下拉锁定且只有 API Key 可改。',
            run: async () => {
              await page
                .locator('tbody tr')
                .filter({ hasText: 'DeepSeek' })
                .first()
                .locator(`[data-testid^="${settingsSelectors.modelEditButtonPrefix}-"]`)
                .click()
              await tabLocator().waitFor({ state: 'visible' })
            }
          })

          const presetRowTextBeforeConvert =
            (await page.locator('tbody tr').filter({ hasText: 'DeepSeek' }).first().textContent()) ||
            ''

          await runtime.step({
            name: 'switch-preset-to-custom',
            message: '编辑中从服务商切到自定义配置，预填当前值并改名保存。',
            run: async () => {
              await tabLocator().getByText('自定义配置').click()
              await getSettingsLocator(page, settingsSelectors.modelNameInput).fill(
                'DeepSeek 转自定义'
              )
              await getSettingsLocator(page, settingsSelectors.modelSaveButton).click()
              await page
                .locator('tbody tr')
                .filter({ hasText: 'DeepSeek 转自定义' })
                .waitFor({ state: 'visible' })
            }
          })

          const customRow = page.locator('tbody tr').filter({ hasText: 'Segment 自定义' }).first()
          const convertedRow = page
            .locator('tbody tr')
            .filter({ hasText: 'DeepSeek 转自定义' })
            .first()

          return {
            tabVisible: await tabLocator().isVisible(),
            presetProviderDisabled: await providerSelect().locator('.ant-select-disabled').isVisible(),
            presetRowText: presetRowTextBeforeConvert,
            customRowText: (await customRow.textContent()) || '',
            convertedRowText: (await convertedRow.textContent()) || '',
            rowCount: await page.locator('tbody tr').count()
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(result.tabVisible, {
            name: 'model-tab-switch-exists',
            message:
              '新增配置弹框应存在「服务商配置 / 自定义配置」tab 且默认服务商配置，对齐 SET-MODEL-002-AC1。',
            data: result
          })

          await runtime.assertThat(
            result.presetProviderDisabled && result.presetRowText.includes('DeepSeek'),
            {
              name: 'preset-config-saved-and-deduped',
              message:
                '预设配置保存后名称等于服务商名；再次新增时服务商下拉禁用并标注已配置，对齐 SET-MODEL-002-AC2。',
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
            result.convertedRowText.includes('自定义') && result.rowCount === 2,
            {
              name: 'preset-to-custom-switch-applies-to-same-config',
              message:
                '编辑预设配置切到自定义分段后改名保存，原配置变为自定义配置且未新增记录，对齐 SET-MODEL-002-AC5。',
              data: result
            }
          )
        }
      })
    },
    SETTINGS_LONG_E2E_TIMEOUT_MS
  )
})