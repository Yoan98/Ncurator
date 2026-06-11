import { describe, it } from 'vitest'
import type { ModelInfo } from '../../../../src/preload/api'
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
    id: 'vector-progress-model',
    name: '进度模型',
    description: '测试下载进度展示',
    tags: ['progress'],
    isDownloaded: false
  }
]

describe('settings vector e2e', () => {
  it('vector-download-progress', async () => {
    await runE2ECase({
      caseId: 'vector-download-progress',
      domain: 'settings',
      suite: 'vector',
      description: '下载过程中页面持续显示百分比、当前文件和文件完成数。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime

        await setSettingsE2EApiOverrides(page, {
          modelCatalog: {
            items: [...MODEL_CATALOG]
          },
          downloadModelResponseByRepoId: {
            'vector-progress-model': {
              success: true
            }
          },
          downloadProgressEventsByRepoId: {
            'vector-progress-model': [
              {
                repoId: 'vector-progress-model',
                file: 'tokenizer.json',
                status: 'downloading',
                progress: 25,
                totalFiles: 4,
                completedFiles: 1
              },
              {
                repoId: 'vector-progress-model',
                file: 'model.onnx',
                status: 'downloading',
                progress: 75,
                totalFiles: 4,
                completedFiles: 3
              }
            ]
          }
        })

        await navigateToSettingsSection(page, 'vector')
        await getSettingsLocator(page, `${vectorSelectors.downloadButtonPrefix}-vector-progress-model`).click()

        return {
          progressText:
            (await getSettingsLocator(
              page,
              `${vectorSelectors.progressPrefix}-vector-progress-model`
            ).textContent()) || '',
          currentFileText:
            (await getSettingsLocator(
              page,
              `${vectorSelectors.currentFilePrefix}-vector-progress-model`
            ).textContent()) || ''
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(
          result.progressText.includes('75%') &&
            result.progressText.includes('3/4 文件') &&
            result.currentFileText.includes('model.onnx'),
          {
            name: 'vector-progress-renders-latest-download-state',
            message:
              '下载过程中，界面应持续更新当前文件、完成数和总进度，对齐 SET-VECTOR-002-AC2。',
            data: result
          }
        )
      }
    })
  }, SETTINGS_E2E_TIMEOUT_MS)
})
