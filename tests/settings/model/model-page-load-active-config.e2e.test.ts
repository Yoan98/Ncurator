import { describe, it } from 'vitest'
import type { LLMConfig } from '../../../src/shared/types'
import { settingsSelectors } from '../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../harness/e2e/run-e2e-case'
import {
  getSettingsLocator,
  navigateToSettingsSection,
  seedModelConfigs
} from '../../harness/e2e/settings'

const SEEDED_CONFIGS: readonly LLMConfig[] = [
  {
    id: 'model-page-load-active',
    name: '当前配置',
    base_url: 'https://api.openai.com/v1',
    model_name: 'gpt-4o',
    api_key: 'sk-model-page-load-active',
    is_active: true
  },
  {
    id: 'model-page-load-standby',
    name: '备用配置',
    base_url: 'https://api.openai.com/v1',
    model_name: 'gpt-4o-mini',
    api_key: 'sk-model-page-load-standby',
    is_active: false
  }
]

describe('settings model e2e', () => {
  it('model-page-load-active-config', async () => {
    await runE2ECase({
      caseId: 'model-page-load-active-config',
      domain: 'settings',
      suite: 'model',
      description: '大模型页首屏加载配置列表，并同时标记当前激活配置。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime

        await runtime.step({
          name: 'seed-configs',
          message: '预置当前激活配置和备用配置。',
          run: async () => {
            await seedModelConfigs(page, SEEDED_CONFIGS)
          }
        })

        await runtime.step({
          name: 'open-model-settings',
          message: '进入大模型页并等待当前模型摘要完成初始化。',
          run: async () => {
            await navigateToSettingsSection(page, 'model')
            await page.waitForFunction(
              (selector) => {
                const host = document.querySelector(selector)
                return host instanceof HTMLElement && host.innerText.includes('gpt-4o')
              },
              `[data-testid="${settingsSelectors.modelSummaryCurrent}"]`
            )
          }
        })

        return {
          rowCount: await page.locator('tbody tr').count(),
          summaryCurrentText:
            (await getSettingsLocator(page, settingsSelectors.modelSummaryCurrent).textContent()) || '',
          currentRowHasTag: await page
            .locator('tbody tr')
            .filter({ hasText: '当前配置' })
            .getByText('当前使用')
            .isVisible()
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(result.rowCount === 2, {
          name: 'model-list-renders-on-first-load',
          message: '页面打开后应直接看到配置列表，而不是停留在未初始化状态，对齐 SET-MODEL-001-AC1。',
          data: result
        })

        await runtime.assertThat(
          result.summaryCurrentText.includes('gpt-4o') && result.currentRowHasTag,
          {
            name: 'active-config-is-marked-in-summary-and-row',
            message:
              '当前激活配置应同时在页头摘要和列表项中具备明确当前态标识，对齐 SET-MODEL-001-AC2。',
            data: result
          }
        )
      }
    })
  })
})
