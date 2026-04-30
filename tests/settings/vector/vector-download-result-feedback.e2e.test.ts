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

const SUCCESS_SEQUENCE: readonly ModelInfo[][] = [
  [
    {
      id: 'vector-result-success',
      name: '成功模型',
      description: '下载成功路径',
      tags: ['success'],
      isDownloaded: false
    }
  ],
  [
    {
      id: 'vector-result-success',
      name: '成功模型',
      description: '下载成功路径',
      tags: ['success'],
      isDownloaded: true
    }
  ]
]

const FAILURE_MODELS: readonly ModelInfo[] = [
  {
    id: 'vector-result-failure',
    name: '失败模型',
    description: '下载失败路径',
    tags: ['failure'],
    isDownloaded: false
  }
]

describe('settings vector e2e', () => {
  it('vector-download-result-feedback', async () => {
    await runE2ECase({
      caseId: 'vector-download-result-feedback',
      domain: 'settings',
      suite: 'vector',
      description: '向量模型下载完成后刷新为已安装，失败时提示原因并退出下载中状态。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime

        await setSettingsE2EApiOverrides(page, {
          modelCatalog: {
            sequence: SUCCESS_SEQUENCE.map((items) => ({ items: [...items] }))
          },
          downloadModelResponseByRepoId: {
            'vector-result-success': {
              success: true
            }
          },
          downloadProgressEventsByRepoId: {
            'vector-result-success': [
              {
                repoId: 'vector-result-success',
                file: 'model.onnx',
                status: 'downloading',
                progress: 50,
                totalFiles: 2,
                completedFiles: 1
              },
              {
                repoId: 'vector-result-success',
                status: 'completed',
                progress: 100
              }
            ]
          }
        })
        await navigateToSettingsSection(page, 'vector')
        await getSettingsLocator(page, `${vectorSelectors.downloadButtonPrefix}-vector-result-success`).click()
        await waitForAntMessage(page, '模型下载完成！')
        const successInstalled = await getSettingsLocator(
          page,
          `${vectorSelectors.installedBadgePrefix}-vector-result-success`
        ).isVisible()

        await setSettingsE2EApiOverrides(page, {
          modelCatalog: {
            items: [...FAILURE_MODELS]
          },
          downloadModelResponseByRepoId: {
            'vector-result-failure': {
              success: true
            }
          },
          downloadProgressEventsByRepoId: {
            'vector-result-failure': [
              {
                repoId: 'vector-result-failure',
                file: 'model.onnx',
                status: 'downloading',
                progress: 50,
                totalFiles: 2,
                completedFiles: 1
              },
              {
                repoId: 'vector-result-failure',
                status: 'error',
                progress: 0,
                error: 'E2E vector download failed'
              }
            ]
          }
        })
        await navigateToSettingsSection(page, 'model')
        await navigateToSettingsSection(page, 'vector')
        await getSettingsLocator(page, `${vectorSelectors.downloadButtonPrefix}-vector-result-failure`).click()
        await waitForAntMessage(page, '下载失败: E2E vector download failed')

        return {
          successInstalled,
          failureDownloadButtonVisible: await getSettingsLocator(
            page,
            `${vectorSelectors.downloadButtonPrefix}-vector-result-failure`
          ).isVisible(),
          failureProgressVisible: await getSettingsLocator(
            page,
            `${vectorSelectors.progressPrefix}-vector-result-failure`
          ).isVisible().catch(() => false)
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(result.successInstalled, {
          name: 'vector-download-success-refreshes-installed-state',
          message:
            '下载完成后，对应模型应刷新为已安装状态，不再显示下载按钮，对齐 SET-VECTOR-003-AC1。',
          data: result
        })

        await runtime.assertThat(
          result.failureDownloadButtonVisible && !result.failureProgressVisible,
          {
            name: 'vector-download-failure-exits-downloading-state',
            message:
              '下载失败时，应提示失败原因并退出下载中状态，对齐 SET-VECTOR-003-AC2。',
            data: result
          }
        )
      }
    })
  }, SETTINGS_E2E_TIMEOUT_MS)
})
