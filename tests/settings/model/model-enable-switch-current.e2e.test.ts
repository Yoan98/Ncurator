import { describe, it } from 'vitest'
import type { LLMConfig } from '../../../src/shared/types'
import { settingsSelectors } from '../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../harness/e2e/run-e2e-case'
import {
  SETTINGS_E2E_TIMEOUT_MS,
  getSettingsLocator,
  navigateToSettingsSection,
  seedModelConfigs
} from '../../harness/e2e/settings'

const SEEDED_CONFIGS: readonly LLMConfig[] = [
  {
    id: 'model-active',
    providerKind: 'openai',
    base_url: 'https://api.openai.com/v1',
    api_key: 'sk-active-config',
    is_active: true,
    default_model: 'gpt-4o'
  },
  {
    id: 'model-next',
    providerKind: 'deepseek',
    base_url: 'https://api.deepseek.com',
    api_key: 'sk-next-config',
    is_active: false,
    default_model: 'deepseek-chat'
  }
]

describe('settings model e2e', () => {
  it('model-enable-switch-current', async () => {
    await runE2ECase({
      caseId: 'model-enable-switch-current',
      domain: 'settings',
      suite: 'model',
      description: '启用非当前连接配置后，当前配置标识切换到目标配置。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime

        await runtime.step({
          name: 'seed-configs',
          message: '通过 IPC 预置一条当前配置和一条待启用配置。',
          run: async () => {
            await seedModelConfigs(page, SEEDED_CONFIGS)
          }
        })

        await runtime.step({
          name: 'switch-current-config',
          message: '进入大模型页并启用待启用配置。',
          run: async () => {
            await navigateToSettingsSection(page, 'model')
            await page.waitForFunction(
              (selector) => {
                const host = document.querySelector(selector)
                return host instanceof HTMLElement && host.innerText.includes('OpenAI')
              },
              `[data-testid="${settingsSelectors.modelSummaryCurrent}"]`
            )
            await getSettingsLocator(
              page,
              `${settingsSelectors.modelActivateButtonPrefix}-model-next`
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

        const summaryCurrentText =
          (await getSettingsLocator(page, settingsSelectors.modelSummaryCurrent).textContent()) || ''
        const activeRowHasTag = await page
          .locator('tbody tr')
          .filter({ hasText: 'https://api.deepseek.com' })
          .getByText('当前使用')
          .isVisible()
        const previousRowCanActivate = await getSettingsLocator(
          page,
          `${settingsSelectors.modelActivateButtonPrefix}-model-active`
        ).isVisible()

        return {
          summaryCurrentText,
          activeRowHasTag,
          previousRowCanActivate
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(
          result.summaryCurrentText.includes('DeepSeek') &&
            result.activeRowHasTag &&
            result.previousRowCanActivate,
          {
            name: 'enable-switches-current-config',
            message:
              '点击“启用”后，目标连接配置应成为当前配置，原激活配置失去当前态并恢复可启用入口，对齐 SET-MODEL-003-AC2。',
            data: result
          }
        )
      }
    })
  }, SETTINGS_E2E_TIMEOUT_MS)
})
