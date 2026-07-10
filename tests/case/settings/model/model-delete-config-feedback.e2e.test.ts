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
  it(
    'model-delete-config-feedback',
    async () => {
      await runE2ECase({
        caseId: 'model-delete-config-feedback',
        domain: 'settings',
        suite: 'model',
        description: '删除连接配置时，成功路径通过真实 UI 刷新列表。',
        fixtures: [],
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime

          await runtime.step({
            name: 'create-configs-through-ui',
            message: '通过 UI 创建保留配置和待删除配置。',
            run: async () => {
              await createModelConfigThroughSettingsUi(page, {
                baseUrl: 'https://api.openai.com/v1',
                apiKey: 'sk-model-delete-active'
              })
              await createModelConfigThroughSettingsUi(page, {
                baseUrl: 'https://api.deepseek.com/v1',
                apiKey: 'sk-model-delete-success'
              })
              await navigateToSettingsSection(page, 'model')
            }
          })

          await runtime.step({
            name: 'delete-config-successfully',
            message: '删除一条配置，确认列表收敛。',
            run: async () => {
              await page
                .locator('tbody tr')
                .filter({ hasText: 'https://api.deepseek.com/v1' })
                .locator('button')
                .last()
                .click()
              await page.getByText('确定要删除此配置吗？').waitFor({ state: 'visible' })
              await page.locator('.ant-popover .ant-btn-primary').click()
              await page
                .locator('tbody tr')
                .filter({ hasText: 'https://api.deepseek.com/v1' })
                .waitFor({ state: 'detached' })
            }
          })

          return {
            deletedRowVisible: await page
              .locator('tbody tr')
              .filter({ hasText: 'https://api.deepseek.com/v1' })
              .count(),
            activeRowStillVisible: await page
              .locator('tbody tr')
              .filter({ hasText: 'https://api.openai.com/v1' })
              .count(),
            tableText:
              (await getSettingsLocator(page, settingsSelectors.modelTable).textContent()) || ''
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(result.deletedRowVisible === 0, {
            name: 'delete-success-removes-config-row',
            message: '删除成功后，被删配置应从列表中消失，对齐 SET-MODEL-003-AC1。',
            data: result
          })

          await runtime.assertThat(
            result.activeRowStillVisible === 1 && result.tableText.includes('OpenAI'),
            {
              name: 'delete-success-keeps-other-configs',
              message: '删除一条配置不应影响其他配置继续展示。',
              data: result
            }
          )
        }
      })
    },
    SETTINGS_E2E_TIMEOUT_MS * 2
  )
})
