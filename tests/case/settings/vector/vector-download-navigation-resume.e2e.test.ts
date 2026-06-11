import { describe, it } from 'vitest'
import type { ActiveDownloadSnapshot, ModelInfo } from '../../../../src/preload/api'
import { vectorSelectors } from '../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import {
  SETTINGS_E2E_TIMEOUT_MS,
  getSettingsLocator,
  navigateToSettingsSection,
  setSettingsE2EApiOverrides
} from '../../../harness/e2e/settings'

const MODEL_CATALOG: readonly ModelInfo[] = [
  {
    id: 'vector-background-model',
    name: '后台下载模型',
    description: '测试离开页面后重新进入仍可恢复当前下载进度。',
    tags: ['resume'],
    isDownloaded: false
  }
]

const ACTIVE_DOWNLOAD_SNAPSHOT: ActiveDownloadSnapshot = {
  repoId: 'vector-background-model',
  status: 'downloading',
  progress: 75,
  currentFile: 'model.onnx',
  totalFiles: 4,
  completedFiles: 3,
  updatedAt: Date.now()
}

describe('settings vector e2e', () => {
  it('vector-download-navigation-resume', async () => {
    await runE2ECase({
      caseId: 'vector-download-navigation-resume',
      domain: 'settings',
      suite: 'vector',
      description: '离开向量模型页面后再次进入，页面可恢复后台仍在进行的下载进度。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime

        await setSettingsE2EApiOverrides(page, {
          modelCatalog: {
            items: [...MODEL_CATALOG]
          },
          activeDownloadSnapshot: ACTIVE_DOWNLOAD_SNAPSHOT
        })

        await navigateToSettingsSection(page, 'vector')
        await getSettingsLocator(
          page,
          `${vectorSelectors.progressPrefix}-vector-background-model`
        ).waitFor({
          state: 'visible'
        })

        await navigateToSettingsSection(page, 'model')
        await navigateToSettingsSection(page, 'vector')

        return {
          progressText:
            (await getSettingsLocator(
              page,
              `${vectorSelectors.progressPrefix}-vector-background-model`
            ).textContent()) || '',
          currentFileText:
            (await getSettingsLocator(
              page,
              `${vectorSelectors.currentFilePrefix}-vector-background-model`
            ).textContent()) || ''
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(
          result.progressText.includes('75%') &&
            result.progressText.includes('3/4 文件') &&
            result.currentFileText.includes('model.onnx'),
          {
            name: 'vector-download-progress-restores-after-navigation',
            message:
              '下载离开页面后继续在后台执行，再次进入页面时应恢复当前文件、完成数和总进度，对齐 SET-VECTOR-002-AC3。',
            data: result
          }
        )
      }
    })
  }, SETTINGS_E2E_TIMEOUT_MS)
})
