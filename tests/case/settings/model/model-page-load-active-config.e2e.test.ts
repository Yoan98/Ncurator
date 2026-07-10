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
  it('model-page-load-active-config', async () => {
    await runE2ECase({
      caseId: 'model-page-load-active-config',
      domain: 'settings',
      suite: 'model',
      description: '大模型页通过真实 UI 创建配置后，重新进入页面仍能展示列表和当前激活配置。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime

        await runtime.step({
          name: 'create-configs-through-ui',
          message: '通过 Settings UI 新增两条连接配置。',
          run: async () => {
            await createModelConfigThroughSettingsUi(page, {
              baseUrl: 'https://api.openai.com/v1',
              apiKey: 'sk-model-page-load-active'
            })
            await createModelConfigThroughSettingsUi(page, {
              baseUrl: 'https://api.deepseek.com/v1',
              apiKey: 'sk-model-page-load-standby'
            })
          }
        })

        await runtime.step({
          name: 'reopen-model-settings',
          message: '切走再返回大模型页，等待当前配置摘要完成初始化。',
          run: async () => {
            await navigateToSettingsSection(page, 'workspace')
            await navigateToSettingsSection(page, 'model')
            await page.waitForFunction(
              (selector) => {
                const host = document.querySelector(selector)
                return host instanceof HTMLElement && host.innerText.includes('OpenAI')
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
            .filter({ hasText: 'https://api.openai.com/v1' })
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
          result.summaryCurrentText.includes('OpenAI') && result.currentRowHasTag,
          {
            name: 'active-config-is-marked-in-summary-and-row',
            message:
              '当前激活配置应同时在页头摘要和列表项中具备明确当前态标识，对齐 SET-MODEL-001-AC2。',
            data: result
          }
        )
      }
    })
  }, SETTINGS_E2E_TIMEOUT_MS * 2)
})
