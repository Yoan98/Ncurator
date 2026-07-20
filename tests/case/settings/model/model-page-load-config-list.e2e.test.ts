import { describe, it } from 'vitest'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import {
  SETTINGS_E2E_TIMEOUT_MS,
  createModelConfigThroughSettingsUi,
  navigateToSettingsSection
} from '../../../harness/e2e/settings'

describe('settings model e2e', () => {
  it(
    'model-page-load-config-list',
    async () => {
      await runE2ECase({
        caseId: 'model-page-load-config-list',
        domain: 'settings',
        suite: 'model',
        description: '大模型页通过真实 UI 创建配置后，重新进入页面仍能展示配置列表。',
        fixtures: [],
        serviceMode: 'real',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime

          await runtime.step({
            name: 'create-configs-through-ui',
            message: '通过 Settings UI 新增两条连接配置。',
            run: async () => {
              await createModelConfigThroughSettingsUi(page, {
                name: '公司 OpenAI',
                baseUrl: 'https://api.openai.com/v1',
                apiKey: 'sk-model-page-load-openai'
              })
              await createModelConfigThroughSettingsUi(page, {
                name: 'DeepSeek 配置',
                baseUrl: 'https://api.deepseek.com/v1',
                apiKey: 'sk-model-page-load-deepseek'
              })
            }
          })

          await runtime.step({
            name: 'reopen-model-settings',
            message: '切走再返回大模型页，等待配置列表完成初始化。',
            run: async () => {
              await navigateToSettingsSection(page, 'workspace')
              await navigateToSettingsSection(page, 'model')
              await page.locator('tbody tr').filter({ hasText: '公司 OpenAI' }).waitFor({
                state: 'visible'
              })
            }
          })

          return {
            rowCount: await page.locator('tbody tr').count(),
            openAiRowText:
              (await page.locator('tbody tr').filter({ hasText: '公司 OpenAI' }).textContent()) ||
              '',
            deepSeekRowText:
              (await page.locator('tbody tr').filter({ hasText: 'DeepSeek 配置' }).textContent()) ||
              ''
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(result.rowCount === 2, {
            name: 'model-list-renders-on-first-load',
            message: '页面打开后应直接看到配置列表，而不是停留在未初始化状态。',
            data: result
          })

          await runtime.assertThat(
            result.openAiRowText.includes('https://api.openai.com/v1') &&
              result.deepSeekRowText.includes('https://api.deepseek.com/v1'),
            {
              name: 'model-list-renders-config-name-and-url',
              message: '配置列表应展示用户配置名称和服务地址。',
              data: result
            }
          )
        }
      })
    },
    SETTINGS_E2E_TIMEOUT_MS * 2
  )
})
