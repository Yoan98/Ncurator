import { describe, it } from 'vitest'
import { vectorSelectors } from '../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import {
  SETTINGS_E2E_TIMEOUT_MS,
  getSettingsLocator,
  navigateToSettingsSection
} from '../../../harness/e2e/settings'

describe('settings vector e2e', () => {
  it('vector-model-catalog-load', async () => {
    await runE2ECase({
      caseId: 'vector-model-catalog-load',
      domain: 'settings',
      suite: 'vector',
      description: '向量模型页首屏通过真实 IPC 加载模型目录，并展示可操作状态。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime

        await navigateToSettingsSection(page, 'vector')
        await page.locator(`[data-testid^="${vectorSelectors.cardPrefix}-"]`).first().waitFor({
          state: 'visible'
        })
        const cardCount = await page.locator(`[data-testid^="${vectorSelectors.cardPrefix}-"]`).count()
        const downloadButtonCount = await page
          .locator(`[data-testid^="${vectorSelectors.downloadButtonPrefix}-"]`)
          .count()
        const installedBadgeCount = await page
          .locator(`[data-testid^="${vectorSelectors.installedBadgePrefix}-"]`)
          .count()
        const catalogErrorVisible = await getSettingsLocator(page, vectorSelectors.catalogError)
          .isVisible()
          .catch(() => false)

        return {
          cardCount,
          downloadButtonCount,
          installedBadgeCount,
          catalogErrorVisible
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(
          result.cardCount > 0 &&
            result.downloadButtonCount + result.installedBadgeCount === result.cardCount &&
            !result.catalogErrorVisible,
          {
            name: 'vector-catalog-renders-real-models',
            message:
              '向量模型页应通过真实模型目录渲染模型卡片，并为每个模型展示下载或已安装状态，对齐 SET-VECTOR-001-AC1。',
            data: result
          }
        )
      }
    })
  }, SETTINGS_E2E_TIMEOUT_MS * 2)
})
