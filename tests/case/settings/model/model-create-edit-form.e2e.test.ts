import { describe, it } from 'vitest'
import { settingsSelectors } from '../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import {
  SETTINGS_E2E_TIMEOUT_MS,
  getSettingsLocator,
  navigateToSettingsSection
} from '../../../harness/e2e/settings'

describe('settings model e2e', () => {
  it(
    'model-create-edit-form',
    async () => {
      await runE2ECase({
        caseId: 'model-create-edit-form',
        domain: 'settings',
        suite: 'model',
        description: '新增和编辑连接配置表单提供配置名称、模型服务地址、API Key 与必填校验。',
        fixtures: [],
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          let validationBlocked = false
          let createMaskClickPreservedForm = false
          let editMaskClickPreservedForm = false
          let createdRowText = ''

          await runtime.step({
            name: 'open-create-form',
            message: '进入大模型页并打开新增配置弹窗。',
            run: async () => {
              await navigateToSettingsSection(page, 'model')
              await getSettingsLocator(page, settingsSelectors.modelAddButton).click()
              await getSettingsLocator(page, settingsSelectors.modelBaseUrlInput).waitFor({
                state: 'visible'
              })
              await getSettingsLocator(page, settingsSelectors.modelNameInput).fill('遮罩保留输入')
              await page
                .locator('.ant-modal-wrap')
                .last()
                .click({ position: { x: 8, y: 8 } })
              createMaskClickPreservedForm =
                (await getSettingsLocator(page, settingsSelectors.modelNameInput).isVisible()) &&
                (await getSettingsLocator(page, settingsSelectors.modelNameInput).inputValue()) ===
                  '遮罩保留输入'
              await getSettingsLocator(page, settingsSelectors.modelNameInput).clear()
            }
          })

          await runtime.step({
            name: 'verify-required-validation',
            message: '在空表单上直接保存，确认必填校验阻止提交。',
            run: async () => {
              await getSettingsLocator(page, settingsSelectors.modelSaveButton).click()
              await page.waitForTimeout(300)
              validationBlocked =
                (await page.locator('.ant-form-item-explain-error').count()) >= 3 &&
                (await page.locator('tbody tr').filter({ hasText: 'sk-create-edit' }).count()) === 0
            }
          })

          await runtime.step({
            name: 'create-config',
            message: '填写新增表单并保存一条连接配置。',
            run: async () => {
              await getSettingsLocator(page, settingsSelectors.modelNameInput).fill('创建编辑测试')
              await getSettingsLocator(page, settingsSelectors.modelBaseUrlInput)
                .locator('input')
                .fill('https://api.openai.com/v1')
              await getSettingsLocator(page, settingsSelectors.modelApiKeyInput).fill(
                'sk-create-edit'
              )
              await getSettingsLocator(page, settingsSelectors.modelSaveButton).click()
              await page
                .locator('tbody tr')
                .filter({ hasText: 'https://api.openai.com/v1' })
                .waitFor({ state: 'visible' })
              createdRowText =
                (await page
                  .locator('tbody tr')
                  .filter({ hasText: 'https://api.openai.com/v1' })
                  .textContent()) || ''
            }
          })

          await runtime.step({
            name: 'open-edit-form',
            message: '打开刚创建配置的编辑弹窗，检查表单预填。',
            run: async () => {
              await page
                .locator('tbody tr')
                .filter({ hasText: 'https://api.openai.com/v1' })
                .locator(`[data-testid^="${settingsSelectors.modelEditButtonPrefix}-"]`)
                .click()
              await getSettingsLocator(page, settingsSelectors.modelBaseUrlInput).waitFor({
                state: 'visible'
              })
              await page
                .locator('.ant-modal-wrap')
                .last()
                .click({ position: { x: 8, y: 8 } })
              editMaskClickPreservedForm =
                (await getSettingsLocator(page, settingsSelectors.modelNameInput).isVisible()) &&
                (await getSettingsLocator(page, settingsSelectors.modelNameInput).inputValue()) ===
                  '创建编辑测试'
            }
          })

          return {
            createFieldVisible:
              (await getSettingsLocator(page, settingsSelectors.modelNameInput).isVisible()) &&
              (await getSettingsLocator(page, settingsSelectors.modelBaseUrlInput)
                .locator('input')
                .isVisible()) &&
              (await getSettingsLocator(page, settingsSelectors.modelApiKeyInput).isVisible()) &&
              !(await getSettingsLocator(page, settingsSelectors.modelProviderInput).isVisible()),
            validationBlocked,
            createMaskClickPreservedForm,
            editMaskClickPreservedForm,
            createdRowText,
            editPrefill: {
              name: await getSettingsLocator(page, settingsSelectors.modelNameInput).inputValue(),
              baseUrl: await getSettingsLocator(page, settingsSelectors.modelBaseUrlInput)
                .locator('input')
                .inputValue(),
              apiKey: await getSettingsLocator(
                page,
                settingsSelectors.modelApiKeyInput
              ).inputValue()
            }
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(result.createFieldVisible, {
            name: 'create-form-shows-required-fields',
            message:
              '新增配置表单应提供配置名称、模型服务地址和 API Key，并默认隐藏服务商适配类型，对齐 SET-MODEL-002-AC1。',
            data: result
          })

          await runtime.assertThat(result.validationBlocked, {
            name: 'required-validation-blocks-empty-save',
            message: '必填字段为空时保存应被拦截，不能直接提交成功，对齐 SET-MODEL-002-AC3。',
            data: result
          })

          await runtime.assertThat(
            result.createMaskClickPreservedForm && result.editMaskClickPreservedForm,
            {
              name: 'model-dialog-mask-click-keeps-form-open',
              message:
                '新增和编辑大模型配置时，点击弹窗遮罩不应关闭表单或清空输入，对齐 SET-MODEL-002-AC6。',
              data: result
            }
          )

          await runtime.assertThat(
            result.editPrefill.name === '创建编辑测试' &&
              result.editPrefill.baseUrl === 'https://api.openai.com/v1' &&
              result.editPrefill.apiKey === 'sk-create-edit',
            {
              name: 'edit-form-prefills-existing-values',
              message:
                '编辑现有配置时，表单应带出当前连接信息，而不是打开空表单，对齐 SET-MODEL-002-AC2。',
              data: result
            }
          )

          await runtime.assertThat(
            result.createdRowText.includes('创建编辑测试') &&
              !/默认|当前|启用/u.test(result.createdRowText),
            {
              name: 'first-config-remains-an-ordinary-service',
              message:
                '空列表中的第一条连接配置保存后应作为普通可用服务展示，不自动产生默认、当前或启用状态，对齐 SET-MODEL-001-AC1、SET-MODEL-001-AC2。',
              data: result
            }
          )
        }
      })
    },
    SETTINGS_E2E_TIMEOUT_MS
  )
})
