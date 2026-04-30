import { describe, it } from 'vitest'
import type { ModelInfo } from '../../../src/preload/api'
import { vectorSelectors } from '../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../harness/e2e/run-e2e-case'
import {
  SETTINGS_E2E_TIMEOUT_MS,
  getSettingsLocator,
  navigateToSettingsSection,
  setSettingsE2EApiOverrides
} from '../../harness/e2e/settings'

const MODEL_CATALOG: readonly ModelInfo[] = [
  {
    id: 'vector-single-task-a',
    name: '模型 A',
    description: '下载中的模型',
    tags: ['A'],
    isDownloaded: false
  },
  {
    id: 'vector-single-task-b',
    name: '模型 B',
    description: '被阻止的模型',
    tags: ['B'],
    isDownloaded: false
  }
]

describe('settings vector e2e', () => {
  it('vector-download-single-task-contract', async () => {
    await runE2ECase({
      caseId: 'vector-download-single-task-contract',
      domain: 'settings',
      suite: 'vector',
      description: '同一时间只允许一个下载任务进行，下载中的进度会持续展示。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime

        await setSettingsE2EApiOverrides(page, {
          modelCatalog: {
            items: [...MODEL_CATALOG]
          },
          downloadModelResponseByRepoId: {
            'vector-single-task-a': {
              success: true
            }
          },
          downloadProgressEventsByRepoId: {
            'vector-single-task-a': [
              {
                repoId: 'vector-single-task-a',
                file: 'weights.bin',
                status: 'downloading',
                progress: 10,
                totalFiles: 4,
                completedFiles: 1
              }
            ]
          }
        })

        await navigateToSettingsSection(page, 'vector')
        await getSettingsLocator(page, `${vectorSelectors.downloadButtonPrefix}-vector-single-task-a`).click()

        return {
          progressVisible: await getSettingsLocator(
            page,
            `${vectorSelectors.progressPrefix}-vector-single-task-a`
          ).isVisible(),
          secondButtonDisabled: await getSettingsLocator(
            page,
            `${vectorSelectors.downloadButtonPrefix}-vector-single-task-b`
          ).isDisabled()
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(result.progressVisible && result.secondButtonDisabled, {
          name: 'vector-download-enforces-single-active-task',
          message:
            '已有下载任务时，其他模型下载入口应不可继续触发新任务，并持续展示当前进度，对齐 SET-VECTOR-002-AC1。',
          data: result
        })
      }
    })
  }, SETTINGS_E2E_TIMEOUT_MS)
})
