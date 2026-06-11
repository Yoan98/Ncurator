import { describe, it } from 'vitest'
import type { LLMConfig } from '../../../../src/shared/types'
import { settingsSelectors } from '../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import {
  SETTINGS_E2E_TIMEOUT_MS,
  getSettingsLocator,
  navigateToSettingsSection,
  seedModelConfigs
} from '../../../harness/e2e/settings'

const SEEDED_CONFIGS: readonly LLMConfig[] = [
  {
    id: 'model-current',
    providerKind: 'openai',
    base_url: 'https://api.openai.com/v1',
    api_key: 'sk-current',
    is_active: true,
    default_model: 'gpt-4o'
  },
  {
    id: 'model-next',
    providerKind: 'deepseek',
    base_url: 'https://api.deepseek.com',
    api_key: 'sk-next',
    is_active: false,
    default_model: 'deepseek-chat'
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
          message: '预置一个当前配置和一个备用配置。',
          run: async () => {
            await seedModelConfigs(page, SEEDED_CONFIGS)
          }
        })

        await runtime.step({
          name: 'edit-active-config',
          message: '打开当前激活配置并保存，触发一次配置变更事件。',
          run: async () => {
            await navigateToSettingsSection(page, 'model')
            await getSettingsLocator(
              page,
              `${settingsSelectors.modelEditButtonPrefix}-${SEEDED_CONFIGS[0].id}`
            ).click()
            await getSettingsLocator(page, settingsSelectors.modelApiKeyInput).fill('sk-current-edited')
            await getSettingsLocator(page, settingsSelectors.modelSaveButton).click()
            await page
              .locator('tbody tr')
              .filter({ hasText: '****ited' })
              .waitFor({ state: 'visible' })
          }
        })

        await runtime.step({
          name: 'switch-active-config',
          message: '切换到备用配置，触发第二次配置变更事件。',
          run: async () => {
            await getSettingsLocator(
              page,
              `${settingsSelectors.modelActivateButtonPrefix}-${SEEDED_CONFIGS[1].id}`
            ).click()
            await page.waitForFunction(
              (selector) => {
                const host = document.querySelector(selector)
                return host instanceof HTMLElement && host.innerText.includes('DeepSeek')
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
            .filter({ hasText: 'https://api.deepseek.com' })
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
          result.summaryText.includes('DeepSeek') &&
            result.currentRowHasTag &&
            result.llmConfigListCalls >= 3,
          {
            name: 'latest-active-config-is-readable-after-change',
            message:
              '事件派发后，界面后续读取到的当前配置应已经更新到最新值，不需要重启页面，对齐 SET-MODEL-004-AC1 与 SET-MODEL-004-AC2。',
            data: result
          }
        )
      }
    })
  }, SETTINGS_E2E_TIMEOUT_MS)
})
