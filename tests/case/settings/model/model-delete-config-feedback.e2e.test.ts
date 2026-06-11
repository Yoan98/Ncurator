import { describe, it } from 'vitest'
import type { LLMConfig } from '../../../../src/shared/types'
import { settingsSelectors } from '../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import {
  SETTINGS_E2E_TIMEOUT_MS,
  getSettingsLocator,
  navigateToSettingsSection,
  seedModelConfigs,
  setSettingsE2EApiOverrides
} from '../../../harness/e2e/settings'

const SEEDED_CONFIGS: readonly LLMConfig[] = [
  {
    id: 'model-delete-active',
    providerKind: 'openai',
    base_url: 'https://api.openai.com/v1',
    api_key: 'sk-model-delete-active',
    is_active: true,
    default_model: 'gpt-4o'
  },
  {
    id: 'model-delete-success',
    providerKind: 'deepseek',
    base_url: 'https://api.deepseek.com',
    api_key: 'sk-model-delete-success',
    is_active: false,
    default_model: 'deepseek-chat'
  },
  {
    id: 'model-delete-failed',
    providerKind: 'openai-compatible',
    base_url: 'https://models.example.test/v1',
    api_key: 'sk-model-delete-failed',
    is_active: false,
    default_model: 'custom-model'
  }
]

describe('settings model e2e', () => {
  it('model-delete-config-feedback', async () => {
    await runE2ECase({
      caseId: 'model-delete-config-feedback',
      domain: 'settings',
      suite: 'model',
      description: '删除连接配置时，成功路径刷新列表，失败路径给出明确错误提示。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime

        await runtime.step({
          name: 'seed-configs',
          message: '预置当前配置、待删除配置和删除失败配置。',
          run: async () => {
            await seedModelConfigs(page, SEEDED_CONFIGS)
            await navigateToSettingsSection(page, 'model')
          }
        })

        await runtime.step({
          name: 'delete-config-successfully',
          message: '删除一条非当前配置，确认列表收敛。',
          run: async () => {
            await getSettingsLocator(
              page,
              `${settingsSelectors.modelDeleteButtonPrefix}-model-delete-success`
            ).click()
            await page.getByText('确定要删除此配置吗？').waitFor({ state: 'visible' })
            await page.locator('.ant-popover .ant-btn-primary').click()
            await page.locator('tbody tr').filter({ hasText: 'https://api.deepseek.com' }).waitFor({
              state: 'detached'
            })
          }
        })

        await runtime.step({
          name: 'delete-config-fails',
          message: '对另一条配置注入删除失败响应，确认页面展示错误提示且保留原记录。',
          run: async () => {
            await setSettingsE2EApiOverrides(page, {
              llmConfigDeleteResponseById: {
                'model-delete-failed': {
                  success: false,
                  error: 'E2E fixture delete failed'
                }
              }
            })
            await getSettingsLocator(
              page,
              `${settingsSelectors.modelDeleteButtonPrefix}-model-delete-failed`
            ).click()
            await page.getByText('确定要删除此配置吗？').waitFor({ state: 'visible' })
            await page.locator('.ant-popover .ant-btn-primary').click()
            await page.getByText('E2E fixture delete failed').waitFor({ state: 'visible' })
          }
        })

        return {
          deletedRowVisible: await page
            .locator('tbody tr')
            .filter({ hasText: 'https://api.deepseek.com' })
            .count(),
          failedRowVisible: await page
            .locator('tbody tr')
            .filter({ hasText: 'https://models.example.test/v1' })
            .count(),
          tableText: (await getSettingsLocator(page, settingsSelectors.modelTable).textContent()) || ''
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(result.deletedRowVisible === 0, {
          name: 'delete-success-removes-config-row',
          message: '删除成功后，被删配置应从列表中消失，对齐 SET-MODEL-005-AC1。',
          data: result
        })

        await runtime.assertThat(
          result.failedRowVisible === 1 && result.tableText.includes('https://models.example.test/v1'),
          {
            name: 'delete-failure-keeps-row-and-shows-error',
            message: '删除失败时，页面应给出明确错误提示，并保留原配置记录，对齐 SET-MODEL-005-AC2。',
            data: result
          }
        )
      }
    })
  }, SETTINGS_E2E_TIMEOUT_MS)
})
