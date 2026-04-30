import { describe, it } from 'vitest'
import type { LLMConfig } from '../../../src/shared/types'
import { settingsSelectors } from '../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../harness/e2e/run-e2e-case'
import {
  SETTINGS_E2E_TIMEOUT_MS,
  getSettingsLocator,
  navigateToSettingsSection,
  seedModelConfigs,
  waitForAntMessage
} from '../../harness/e2e/settings'

const SEEDED_CONFIGS: readonly LLMConfig[] = [
  {
    id: 'model-active-event-current',
    name: '当前模型',
    base_url: 'https://api.openai.com/v1',
    model_name: 'gpt-4o',
    api_key: 'sk-current',
    is_active: true
  },
  {
    id: 'model-active-event-next',
    name: '下一个模型',
    base_url: 'https://api.openai.com/v1',
    model_name: 'gpt-4o-mini',
    api_key: 'sk-next',
    is_active: false
  }
]

describe('settings model e2e', () => {
  it('model-active-config-change-event', async () => {
    await runE2ECase({
      caseId: 'model-active-config-change-event',
      domain: 'settings',
      suite: 'model',
      description: '编辑当前激活配置与切换当前配置后，renderer 会派发 check-llm-config 事件。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime

        await runtime.step({
          name: 'seed-configs',
          message: '预置一个当前模型和一个备用模型。',
          run: async () => {
            await seedModelConfigs(page, SEEDED_CONFIGS)
          }
        })

        await runtime.step({
          name: 'edit-active-config',
          message: '打开当前激活配置并保存，触发一次模型变更事件。',
          run: async () => {
            await navigateToSettingsSection(page, 'model')
            await getSettingsLocator(
              page,
              `${settingsSelectors.modelEditButtonPrefix}-${SEEDED_CONFIGS[0].id}`
            ).click()
            await getSettingsLocator(page, settingsSelectors.modelNameInput).fill('当前模型-已编辑')
            await getSettingsLocator(page, settingsSelectors.modelSaveButton).click()
            await page
              .locator('tbody tr')
              .filter({ hasText: '当前模型-已编辑' })
              .waitFor({ state: 'visible' })
          }
        })

        await runtime.step({
          name: 'switch-active-config',
          message: '切换到备用模型，触发第二次模型变更事件。',
          run: async () => {
            await getSettingsLocator(
              page,
              `${settingsSelectors.modelActivateButtonPrefix}-${SEEDED_CONFIGS[1].id}`
            ).click()
            await page.waitForFunction(
              (selector) => {
                const host = document.querySelector(selector)
                return host instanceof HTMLElement && host.innerText.includes('gpt-4o-mini')
              },
              `[data-testid="${settingsSelectors.modelSummaryCurrent}"]`
            )
          }
        })

        const signals = await runtime.collectSignals()

        return {
          domEventNames: signals.domEventEntries.map((entry) => entry.name),
          llmConfigListCalls: signals.ipcInvokeEntries.filter((entry) => entry.name === 'llmConfigList')
            .length,
          summaryText:
            (await getSettingsLocator(page, settingsSelectors.modelSummaryCurrent).textContent()) || '',
          currentRowHasTag: await page
            .locator('tbody tr')
            .filter({ hasText: '下一个模型' })
            .getByText('当前使用')
            .isVisible()
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(
          result.domEventNames.filter((name) => name === 'check-llm-config').length >= 2,
          {
            name: 'model-change-paths-dispatch-check-event',
            message:
              '编辑当前激活配置与切换当前配置两条成功路径都应派发 check-llm-config 事件，对齐 SET-MODEL-004-AC1。',
            data: result
          }
        )

        await runtime.assertThat(
          result.summaryText.includes('gpt-4o-mini') &&
            result.currentRowHasTag &&
            result.llmConfigListCalls >= 3,
          {
            name: 'latest-active-config-is-readable-after-change',
            message:
              '事件派发后，界面后续读取到的当前模型应已经更新到最新值，不需要重启页面，对齐 SET-MODEL-004-AC1 与 SET-MODEL-004-AC2。',
            data: result
          }
        )
      }
    })
  }, SETTINGS_E2E_TIMEOUT_MS)
})
