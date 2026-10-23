import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'vitest'
import { vectorSelectors } from '../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import { getSettingsLocator, navigateToSettingsSection } from '../../../harness/e2e/settings'

const CASE_ID = 'vector-model-download-delete-flow'
const MODEL_ID = 'jinaai/jina-embeddings-v2-base-zh'
const VECTOR_DOWNLOAD_E2E_TIMEOUT_MS = 20 * 60 * 1000

const modelLocator = (testIdPrefix: string) => `${testIdPrefix}-${MODEL_ID}`

describe('settings vector real download e2e', () => {
  it(
    CASE_ID,
    async () => {
      const modelsPath = await mkdtemp(path.join(os.tmpdir(), 'ncurator-vector-download-'))
      try {
        await runE2ECase({
          caseId: CASE_ID,
          domain: 'settings',
          suite: 'vector',
          description:
            '用户通过真实 Settings 页面下载产品列表中的向量模型，观察进度和页面恢复，再完成删除确认、取消与成功删除。',
          fixtures: [],
          knowledge: 'cold',
          serviceMode: 'real',
          extraEnv: {
            NCURATOR_MODELS_PATH: modelsPath
          },
          windowMode: 'visible',
          runMode: 'single',
          execute: async (runtime) => {
            const { page } = runtime
            await navigateToSettingsSection(page, 'vector')

            const downloadButton = getSettingsLocator(
              page,
              modelLocator(vectorSelectors.downloadButtonPrefix)
            )
            await downloadButton.waitFor({ state: 'visible' })
            await downloadButton.click()

            const progress = getSettingsLocator(page, modelLocator(vectorSelectors.progressPrefix))
            await progress.waitFor({ state: 'visible' })
            const currentFile = getSettingsLocator(
              page,
              modelLocator(vectorSelectors.currentFilePrefix)
            )
            await page.waitForFunction(
              (testId) =>
                Boolean(document.querySelector(`[data-testid="${testId}"]`)?.textContent?.trim()),
              modelLocator(vectorSelectors.currentFilePrefix)
            )
            const progressText = (await progress.innerText()) || ''
            const currentFileText = (await currentFile.textContent()) || ''

            await navigateToSettingsSection(page, 'model')
            await navigateToSettingsSection(page, 'vector')
            const restoredProgress = getSettingsLocator(
              page,
              modelLocator(vectorSelectors.progressPrefix)
            )
            await restoredProgress.waitFor({ state: 'visible' })
            const restoredProgressText = (await restoredProgress.innerText()) || ''

            const installedBadge = getSettingsLocator(
              page,
              modelLocator(vectorSelectors.installedBadgePrefix)
            )
            const downloadError = getSettingsLocator(
              page,
              modelLocator(vectorSelectors.errorPrefix)
            )
            const completion = await Promise.race([
              installedBadge
                .waitFor({
                  state: 'visible',
                  timeout: VECTOR_DOWNLOAD_E2E_TIMEOUT_MS - 60_000
                })
                .then(() => ({ status: 'installed' as const, error: '' })),
              downloadError
                .waitFor({
                  state: 'visible',
                  timeout: VECTOR_DOWNLOAD_E2E_TIMEOUT_MS - 60_000
                })
                .then(async () => ({
                  status: 'error' as const,
                  error: ((await downloadError.textContent()) || '').trim()
                }))
            ])
            if (completion.status === 'error') {
              throw new Error(
                `vector model download failed: ${completion.error || 'unknown error'}`
              )
            }

            const deleteButton = getSettingsLocator(
              page,
              modelLocator(vectorSelectors.deleteButtonPrefix)
            )
            await deleteButton.click()
            const cancelButton = getSettingsLocator(
              page,
              modelLocator(vectorSelectors.deleteCancelButtonPrefix)
            )
            await cancelButton.waitFor({ state: 'visible' })
            await cancelButton.click()
            const installedAfterCancel = await installedBadge.isVisible()

            await deleteButton.click()
            await getSettingsLocator(
              page,
              modelLocator(vectorSelectors.deleteConfirmButtonPrefix)
            ).click()
            await downloadButton.waitFor({ state: 'visible' })

            const signals = await runtime.collectSignals()
            return {
              progressText,
              currentFileText,
              restoredProgressText,
              installedAfterCancel,
              downloadVisibleAfterDelete: await downloadButton.isVisible(),
              downloadCalls: signals.ipcInvokeEntries.filter(
                (entry) => entry.name === 'downloadModel'
              ).length,
              deleteCalls: signals.ipcInvokeEntries.filter((entry) => entry.name === 'deleteModel')
                .length
            }
          },
          assert: async (result, runtime) => {
            await runtime.assertThat(
              result.progressText.includes('下载') &&
                result.currentFileText.length > 0 &&
                result.restoredProgressText.includes('下载'),
              {
                name: 'real-vector-download-progress-survives-navigation',
                message:
                  '产品列表中的模型下载应展示真实文件和进度，离开页面再返回后继续展示下载状态。',
                data: result
              }
            )
            await runtime.assertThat(
              result.installedAfterCancel && result.downloadVisibleAfterDelete,
              {
                name: 'real-vector-delete-confirmation-flow',
                message: '取消删除应保持已安装，确认删除后应恢复下载入口。',
                data: result
              }
            )
            await runtime.assertThat(result.downloadCalls === 1 && result.deleteCalls === 1, {
              name: 'real-vector-actions-use-product-ipc',
              message: '下载和确认删除必须由真实用户操作触发真实产品 IPC。',
              data: result
            })
          }
        })
      } finally {
        await rm(modelsPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
      }
    },
    VECTOR_DOWNLOAD_E2E_TIMEOUT_MS
  )
})
