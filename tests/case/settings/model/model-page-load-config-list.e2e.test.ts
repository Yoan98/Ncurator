import { describe, it } from 'vitest'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import {
  SETTINGS_E2E_TIMEOUT_MS,
  createModelConfigThroughSettingsUi,
  createPresetModelConfigThroughSettingsUi,
  navigateToSettingsSection
} from '../../../harness/e2e/settings'
import { settingsSelectors } from '../../../../src/renderer/src/testing/selectors'

describe('settings model e2e', () => {
  it(
    'model-page-load-config-list',
    async () => {
      await runE2ECase({
        caseId: 'model-page-load-config-list',
        domain: 'settings',
        suite: 'model',
        description: '大模型页通过真实 UI 创建预设与自定义配置后，重新进入页面仍能展示配置列表。',
        fixtures: [],
        serviceMode: 'real',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime

          await runtime.step({
            name: 'create-configs-through-ui',
            message: '通过 Settings UI 新增一条预设配置和一条自定义配置。',
            run: async () => {
              await createPresetModelConfigThroughSettingsUi(page, {
                providerId: 'moonshot',
                apiKey: 'sk-model-page-load-kimi'
              })
              await createModelConfigThroughSettingsUi(page, {
                name: '公司自定义',
                baseUrl: 'https://custom.example.com/v1',
                apiKey: 'sk-model-page-load-custom'
              })
            }
          })

          await runtime.step({
            name: 'reopen-model-settings',
            message: '切走再返回大模型页，等待配置列表完成初始化。',
            run: async () => {
              await navigateToSettingsSection(page, 'workspace')
              await navigateToSettingsSection(page, 'model')
              await page.locator('tbody tr').filter({ hasText: 'Kimi' }).waitFor({
                state: 'visible'
              })
            }
          })

          const kimiRow = page.locator('tbody tr').filter({ hasText: 'Kimi' }).first()
          const customRow = page
            .locator('tbody tr')
            .filter({ hasText: '公司自定义' })
            .first()

          return {
            rowCount: await page.locator('tbody tr').count(),
            kimiRowText: (await kimiRow.textContent()) || '',
            customRowText: (await customRow.textContent()) || '',
            customTagCount: await page
              .locator(`[data-testid="${settingsSelectors.modelCustomTag}"]`)
              .count()
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(result.rowCount === 2, {
            name: 'model-list-renders-on-first-load',
            message: '页面打开后应直接看到配置列表，而不是停留在未初始化状态。',
            data: result
          })

          await runtime.assertThat(
            result.kimiRowText.includes('Kimi') &&
              !result.kimiRowText.includes('自定义') &&
              result.customRowText.includes('公司自定义') &&
              result.customTagCount === 1,
            {
              name: 'model-list-distinguishes-preset-and-custom',
              message:
                '配置列表应展示服务商图标与名称；自定义配置以「自定义」标签区分，预设配置不展示，对齐 SET-MODEL-001-AC1、SET-MODEL-001-AC2、SET-MODEL-001-AC3。',
              data: result
            }
          )
        }
      })
    },
    SETTINGS_E2E_TIMEOUT_MS * 2
  )
})