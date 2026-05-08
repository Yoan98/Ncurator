import { describe, it } from 'vitest'
import type { LLMConfig } from '../../../src/shared/types'
import { settingsSelectors } from '../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../harness/e2e/run-e2e-case'
import {
  SETTINGS_E2E_TIMEOUT_MS,
  getSettingsLocator,
  navigateToSettingsSection,
  seedModelConfigs,
  setSettingsE2EApiOverrides
} from '../../harness/e2e/settings'

const SEEDED_CONFIG: LLMConfig = {
  id: 'model-refresh-config',
  providerKind: 'openai',
  base_url: 'https://api.openai.com/v1',
  api_key: 'sk-refresh',
  is_active: true
}

describe('settings model e2e', () => {
  it('model-remote-list-refresh', async () => {
    await runE2ECase({
      caseId: 'model-remote-list-refresh',
      domain: 'settings',
      suite: 'model',
      description: '连接配置可刷新远端模型列表，并在失败时给出明确反馈。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime

        await runtime.step({
          name: 'seed-config',
          message: '预置一个当前连接配置并打开大模型页。',
          run: async () => {
            await seedModelConfigs(page, [SEEDED_CONFIG])
            await navigateToSettingsSection(page, 'model')
          }
        })

        await runtime.step({
          name: 'refresh-model-list-success',
          message: '注入模型列表成功响应并刷新。',
          run: async () => {
            await setSettingsE2EApiOverrides(page, {
              llmModelListResponseByConfigId: {
                [SEEDED_CONFIG.id]: {
                  success: true,
                  items: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }]
                }
              }
            })
            await getSettingsLocator(
              page,
              `${settingsSelectors.modelRefreshButtonPrefix}-${SEEDED_CONFIG.id}`
            ).click()
            await page.locator('tbody tr').filter({ hasText: '2 个模型' }).waitFor({
              state: 'visible'
            })
          }
        })

        const successText = (await getSettingsLocator(page, settingsSelectors.modelTable).textContent()) || ''

        await runtime.step({
          name: 'refresh-model-list-failed',
          message: '注入模型列表失败响应并确认错误态。',
          run: async () => {
            await setSettingsE2EApiOverrides(page, {
              llmModelListResponseByConfigId: {
                [SEEDED_CONFIG.id]: {
                  success: false,
                  items: [],
                  error: 'E2E model list failed'
                }
              }
            })
            await getSettingsLocator(
              page,
              `${settingsSelectors.modelRefreshButtonPrefix}-${SEEDED_CONFIG.id}`
            ).click()
            await page.getByText('获取失败').waitFor({ state: 'visible' })
          }
        })

        return {
          successText,
          failureText: (await getSettingsLocator(page, settingsSelectors.modelTable).textContent()) || ''
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(result.successText.includes('2 个模型'), {
          name: 'remote-model-list-refresh-shows-count',
          message: '刷新模型列表成功后，应展示可用模型数量，对齐 SET-MODEL-002-AC4。',
          data: result
        })

        await runtime.assertThat(result.failureText.includes('获取失败'), {
          name: 'remote-model-list-refresh-failure-shows-error-state',
          message: '刷新模型列表失败时，应显示明确失败状态和错误提示，对齐 SET-MODEL-002-AC5。',
          data: result
        })
      }
    })
  }, SETTINGS_E2E_TIMEOUT_MS)
})
