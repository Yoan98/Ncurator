import { lstat, mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'vitest'
import { vectorSelectors } from '../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import { getSettingsLocator, navigateToSettingsSection } from '../../../harness/e2e/settings'

const CASE_ID = 'vector-model-download-delete-while-active'
const MODEL_ID = 'jinaai/jina-embeddings-v2-base-zh'
const VECTOR_DOWNLOAD_START_E2E_TIMEOUT_MS = 5 * 60 * 1000

const modelLocator = (testIdPrefix: string) => `${testIdPrefix}-${MODEL_ID}`

describe('settings vector real download e2e', () => {
  it(
    CASE_ID,
    async () => {
      const modelsPath = await mkdtemp(path.join(os.tmpdir(), 'ncurator-vector-delete-active-'))
      try {
        const isolatedProfilePath = path.join(modelsPath, 'profile')
        await mkdir(isolatedProfilePath, { recursive: true })
        await runE2ECase({
          caseId: CASE_ID,
          domain: 'settings',
          suite: 'vector',
          description:
            '用户在真实下载过程中删除向量模型：下载被取消、已下载文件被移除、页面回到可下载状态且不提示失败。',
          fixtures: [],
          serviceMode: 'real',
          extraEnv: {
            NCURATOR_MODELS_PATH: modelsPath,
            ...(process.platform === 'win32'
              ? { USERPROFILE: isolatedProfilePath }
              : { HOME: isolatedProfilePath })
          },
          windowMode: 'visible',
          runMode: 'single',
          execute: async (runtime) => {
            const { page } = runtime
            const modelPath = path.join(modelsPath, MODEL_ID)
            await navigateToSettingsSection(page, 'vector')

            const downloadButton = getSettingsLocator(
              page,
              modelLocator(vectorSelectors.downloadButtonPrefix)
            )
            await downloadButton.waitFor({ state: 'visible' })
            await downloadButton.click()

            const progress = getSettingsLocator(page, modelLocator(vectorSelectors.progressPrefix))
            await progress.waitFor({ state: 'visible', timeout: 180_000 })
            await page.waitForFunction(
              (testId) =>
                Boolean(
                  document
                    .querySelector(`[data-testid="${testId}"]`)
                    ?.textContent?.includes('onnx/model.onnx')
                ),
              modelLocator(vectorSelectors.currentFilePrefix),
              { timeout: 180_000 }
            )
            const progressText = (await progress.innerText()) || ''

            const deleteButton = getSettingsLocator(
              page,
              modelLocator(vectorSelectors.deleteButtonPrefix)
            )
            await deleteButton.waitFor({ state: 'visible' })
            await deleteButton.click()
            await getSettingsLocator(
              page,
              modelLocator(vectorSelectors.deleteCancelButtonPrefix)
            ).waitFor({ state: 'visible' })
            await getSettingsLocator(
              page,
              modelLocator(vectorSelectors.deleteConfirmButtonPrefix)
            ).click()

            await downloadButton.waitFor({ state: 'visible', timeout: 60_000 })
            await progress.waitFor({ state: 'hidden', timeout: 60_000 })

            const modelDirExists = await lstat(modelPath)
              .then(() => true)
              .catch((error: NodeJS.ErrnoException) => {
                if (error.code === 'ENOENT') return false
                throw error
              })

            const downloadError = getSettingsLocator(
              page,
              modelLocator(vectorSelectors.errorPrefix)
            )

            const signals = await runtime.collectSignals()
            return {
              progressText,
              downloadVisibleAfterDelete: await downloadButton.isVisible(),
              progressHiddenAfterDelete: !(await progress.isVisible()),
              modelDirExists,
              errorVisible: await downloadError.isVisible(),
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
                result.downloadVisibleAfterDelete &&
                result.progressHiddenAfterDelete,
              {
                name: 'real-vector-delete-while-downloading-resets-to-downloadable',
                message:
                  '下载中删除后应取消下载、移除进度展示并恢复下载入口，对齐 SET-VECTOR-004-AC5。',
                data: result
              }
            )
            await runtime.assertThat(result.modelDirExists === false, {
              name: 'real-vector-delete-while-downloading-removes-files',
              message: '下载中删除应移除已下载的部分文件，模型目录不复存在。',
              data: result
            })
            await runtime.assertThat(result.errorVisible === false, {
              name: 'real-vector-delete-while-downloading-no-failure',
              message: '主动删除中断下载不应出现下载失败错误提示，对齐 SET-VECTOR-004-AC6。',
              data: result
            })
            await runtime.assertThat(result.downloadCalls === 1 && result.deleteCalls === 1, {
              name: 'real-vector-actions-use-product-ipc',
              message: '下载和下载中删除必须由真实用户操作触发真实产品 IPC。',
              data: result
            })
          }
        })
      } finally {
        await rm(modelsPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
      }
    },
    VECTOR_DOWNLOAD_START_E2E_TIMEOUT_MS
  )
})
