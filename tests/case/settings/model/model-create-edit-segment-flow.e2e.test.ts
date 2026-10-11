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
          let presetProviderDisabled = false
          let presetConfiguredLabel = false
          let presetDefaultAddress = ''
          let defaultRecommendChecked = false
          const modal = getSettingsLocator(page, settingsSelectors.modelModal).locator(
            '.ant-modal-content'
          )
          const field = (id: string) => getSettingsLocator(page, id)
          const requiredBlocked: boolean[] = []
          let duplicateBlocked = false
          let maskPreservesInput = false
          let customPrefillCorrect = false

          await runtime.step({
            name: 'open-create-form-preset-default',
            message: '打开新增弹框，确认推荐类型默认选中、服务商下拉可见且无名称输入框。',
            run: async () => {
              await navigateToSettingsSection(page, 'model')
              await getSettingsLocator(page, settingsSelectors.modelAddButton).click()
              await providerSelect().waitFor({ state: 'visible' })
              defaultRecommendChecked = await field(settingsSelectors.modelTypeRecommend).evaluate(
                (element) =>
                  element instanceof HTMLInputElement
                    ? element.checked
                    : element.querySelector('input')?.checked === true
              )
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
              await providerSelect().locator('.ant-select-selector').click()
              const dropdown = page
                .locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')
                .last()
              await dropdown.waitFor({ state: 'visible' })
              presetDefaultAddress =
                (await page.evaluate(() => window.api.llmConfigList())).find(
                  (config) => config.name === 'DeepSeek'
                )?.base_url || ''
              presetConfiguredLabel = (
                await dropdown
                  .locator('.ant-select-item-option')
                  .filter({ hasText: 'DeepSeek' })
                  .innerText()
              ).includes('已配置')
              presetProviderDisabled = await dropdown
                .locator('.ant-select-item-option')
                .filter({ hasText: 'DeepSeek' })
                .first()
                .evaluate((element) =>
                  element.classList.contains('ant-select-item-option-disabled')
                )
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
              for (const [id, value, error] of [
                [settingsSelectors.modelNameInput, 'Segment 自定义', '请输入名称'],
                [
                  settingsSelectors.modelBaseUrlInput,
                  'https://segment.local/v1',
                  '请输入模型服务地址'
                ],
                [settingsSelectors.modelApiKeyInput, 'sk-segment-custom', '请输入 API Key']
              ]) {
                await field(id).fill('')
                await field(settingsSelectors.modelSaveButton).click()
                await modal.getByText(error, { exact: true }).waitFor({ state: 'visible' })
                requiredBlocked.push(
                  (await modal.isVisible()) && (await page.locator('tbody tr').count()) === 1
                )
                await field(id).fill(value)
              }
              await getSettingsLocator(page, settingsSelectors.modelSaveButton).click()
              await page
                .locator('tbody tr')
                .filter({ hasText: 'Segment 自定义' })
                .waitFor({ state: 'visible' })
            }
          })

          await modal.waitFor({ state: 'hidden' })
          await page
            .locator('tbody tr')
            .filter({ hasText: 'Segment 自定义' })
            .locator(`[data-testid^="${settingsSelectors.modelEditButtonPrefix}-"]`)
            .click()
          customPrefillCorrect =
            (await field(settingsSelectors.modelNameInput).inputValue()) === 'Segment 自定义' &&
            (await field(settingsSelectors.modelBaseUrlInput).inputValue()) ===
              'https://segment.local/v1' &&
            (await field(settingsSelectors.modelApiKeyInput).inputValue()) === 'sk-segment-custom'
          await field(settingsSelectors.modelCancelButton).click()
          await modal.waitFor({ state: 'hidden' })
          await field(settingsSelectors.modelAddButton).click()
          await customRadio().click()
          await field(settingsSelectors.modelNameInput).fill('Segment 自定义')
          await field(settingsSelectors.modelBaseUrlInput).fill('https://duplicate.local/v1')
          await field(settingsSelectors.modelApiKeyInput).fill('sk-duplicate')
          await page.locator('.ant-modal-wrap:visible').click({ position: { x: 5, y: 5 } })
          maskPreservesInput =
            (await modal.isVisible()) &&
            (await field(settingsSelectors.modelBaseUrlInput).inputValue()) ===
              'https://duplicate.local/v1'
          await field(settingsSelectors.modelSaveButton).click()
          await page
            .getByText(/名称.*(已存在|重复)|同名/)
            .first()
            .waitFor({ state: 'visible' })
          duplicateBlocked =
            (await modal.isVisible()) && (await page.locator('tbody tr').count()) === 2
          await field(settingsSelectors.modelCancelButton).click()
          await modal.waitFor({ state: 'hidden' })

          let presetProviderSelectLocked = false

          await runtime.step({
            name: 'edit-preset-change-provider',
            message: '编辑 DeepSeek 推荐配置，服务商下拉可改，换成智谱 GLM 保存。',
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
              await selectSettingsPresetProviderOption(page, '智谱 GLM')
              await getSettingsLocator(page, settingsSelectors.modelSaveButton).click()
              await page
                .locator('tbody tr')
                .filter({ hasText: '智谱 GLM' })
                .waitFor({ state: 'visible' })
            }
          })

          const customRow = page.locator('tbody tr').filter({ hasText: 'Segment 自定义' }).first()
          const zhipuRow = page.locator('tbody tr').filter({ hasText: '智谱 GLM' }).first()

          return {
            defaultRecommendChecked,
            presetConfiguredLabel,
            presetDefaultAddress,
            requiredBlocked,
            duplicateBlocked,
            maskPreservesInput,
            customPrefillCorrect,
            presetNameInputCount,
            presetProviderDisabled,
            presetProviderSelectLocked,
            customRowText: (await customRow.textContent()) || '',
            zhipuRowText: (await zhipuRow.textContent()) || '',
            rowCount: await page.locator('tbody tr').count()
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.requiredBlocked.length === 3 &&
              result.requiredBlocked.every(Boolean) &&
              result.duplicateBlocked &&
              result.maskPreservesInput &&
              result.customPrefillCorrect,
            {
              name: 'custom-form-validation-and-prefill',
              message:
                '自定义必填和重名拦截、完整回填及遮罩保留输入，对齐 SET-MODEL-002-AC3/AC4/AC5/AC6。',
              data: result
            }
          )
          await runtime.assertThat(
            result.presetNameInputCount === 0 && result.defaultRecommendChecked,
            {
              name: 'preset-has-no-name-input',
              message:
                '推荐类型不展示名称输入框，名称由系统维护为服务商名，对齐 SET-MODEL-002-AC1。',
              data: result
            }
          )

          await runtime.assertThat(
            result.presetProviderDisabled &&
              result.presetConfiguredLabel &&
              result.presetDefaultAddress === 'https://api.deepseek.com',
            {
              name: 'preset-config-saved-and-deduped',
              message:
                '推荐配置保存后名称等于服务商名；再次新增时服务商下拉禁用并标注已配置，对齐 SET-MODEL-002-AC2。',
              data: result
            }
          )

          await runtime.assertThat(result.customRowText.includes('自定义'), {
            name: 'custom-config-flagged',
            message: '自定义配置在列表中以「自定义」标签区分展示，对齐 SET-MODEL-001-AC3。',
            data: result
          })

          await runtime.assertThat(
            !result.presetProviderSelectLocked &&
              result.zhipuRowText.includes('智谱 GLM') &&
              !result.zhipuRowText.includes('自定义') &&
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
