import { describe, it } from 'vitest'
import type { ModelInfo } from '../../../src/preload/api'
import { vectorSelectors } from '../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../harness/e2e/run-e2e-case'
import {
  SETTINGS_E2E_TIMEOUT_MS,
  getSettingsLocator,
  navigateToSettingsSection,
  setSettingsE2EApiOverrides,
  waitForAntMessage
} from '../../harness/e2e/settings'

const MODEL_CATALOG: readonly ModelInfo[] = [
  {
    id: 'vector-model-installed',
    name: '已安装模型',
    description: '已经安装的向量模型',
    tags: ['中文优化', '1GB'],
    isDownloaded: true
  },
  {
    id: 'vector-model-downloadable',
    name: '可下载模型',
    description: '尚未安装的向量模型',
    tags: ['通用', '512MB'],
    isDownloaded: false
  }
]

describe('settings vector e2e', () => {
  it('vector-model-catalog-load', async () => {
    await runE2ECase({
      caseId: 'vector-model-catalog-load',
      domain: 'settings',
      suite: 'vector',
      description: '向量模型页首屏能加载目录，失败时提供明确错误提示。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime

        await setSettingsE2EApiOverrides(page, {
          modelCatalog: {
            items: [...MODEL_CATALOG]
          }
        })
        await navigateToSettingsSection(page, 'vector')
        await getSettingsLocator(
          page,
          `${vectorSelectors.cardPrefix}-${MODEL_CATALOG[1].id}`
        ).waitFor({ state: 'visible' })
        const installedVisible = await getSettingsLocator(
          page,
          `${vectorSelectors.installedBadgePrefix}-${MODEL_CATALOG[0].id}`
        ).isVisible()
        const downloadableVisible = await getSettingsLocator(
          page,
          `${vectorSelectors.downloadButtonPrefix}-${MODEL_CATALOG[1].id}`
        ).isVisible()

        await setSettingsE2EApiOverrides(page, {
          modelCatalog: {
            error: 'E2E vector catalog failed'
          }
        })
        await page.reload()
        await navigateToSettingsSection(page, 'vector')
        await waitForAntMessage(page, '获取模型列表失败')

        return {
          cardCount: await page.locator(`[data-testid^="${vectorSelectors.cardPrefix}-"]`).count(),
          installedVisible,
          downloadableVisible
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(
          result.cardCount === 2 && result.installedVisible && result.downloadableVisible,
          {
            name: 'vector-catalog-renders-installed-and-downloadable-models',
            message:
              '模型列表加载成功后，应能区分已安装模型与可下载模型，对齐 SET-VECTOR-001-AC1。',
            data: result
          }
        )
      }
    })
  }, SETTINGS_E2E_TIMEOUT_MS * 2)
})
