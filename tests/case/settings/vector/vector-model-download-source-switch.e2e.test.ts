import fs from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'vitest'
import { vectorSelectors } from '../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import {
  getSettingsLocator,
  navigateToSettingsSection,
  SETTINGS_LONG_E2E_TIMEOUT_MS
} from '../../../harness/e2e/settings'

const CASE_ID = 'vector-model-download-source-switch'
const MODEL_ID = 'jinaai/jina-embeddings-v2-base-zh'
const VECTOR_SWITCH_E2E_TIMEOUT_MS = 5 * 60 * 1000

const REQUIRED_FILES = [
  '1_Pooling/config.json',
  'config.json',
  'config_sentence_transformers.json',
  'merges.txt',
  'modules.json',
  'onnx/model.onnx',
  'sentence_bert_config.json',
  'special_tokens_map.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'vocab.json'
]

const modelLocator = (testIdPrefix: string): string => `${testIdPrefix}-${MODEL_ID}`

const startMockServer = async (
  handler: (url: URL) => Promise<{ status: number; body?: string }>
): Promise<{ server: Server; origin: string }> => {
  const server = createServer((request, response) => {
    void (async () => {
      try {
        const url = new URL(request.url || '/', 'http://127.0.0.1')
        const result = await handler(url)
        const body = result.body ?? ''
        response.writeHead(result.status, {
          'content-length': Buffer.byteLength(body)
        })
        response.end(body)
      } catch (error) {
        response.writeHead(500)
        response.end(String(error instanceof Error ? error.message : String(error)))
      }
    })()
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address() as AddressInfo
  return { server, origin: `http://127.0.0.1:${String(address.port)}` }
}

const waitForDirectoryRemoved = async (dir: string, timeoutMs: number): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!fs.existsSync(dir)) {
      return
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`model directory was not removed after failed download: ${dir}`)
}

describe('settings vector download source switch e2e', () => {
  it(
    CASE_ID,
    async () => {
      const modelsPath = await mkdtemp(path.join(os.tmpdir(), 'ncurator-vector-switch-'))
      const modelscopeServer = await startMockServer(async () => ({
        status: 500,
        body: 'modelscope unavailable'
      }))
      const huggingfaceServer = await startMockServer(async (url) => {
        if (url.pathname.endsWith('/api/models/jinaai/jina-embeddings-v2-base-zh')) {
          return {
            status: 200,
            body: JSON.stringify({
              siblings: REQUIRED_FILES.map((file) => ({ rfilename: file }))
            })
          }
        }
        if (url.pathname.includes('/resolve/main/')) {
          return { status: 200, body: 'mock-model-file-content' }
        }
        return { status: 404, body: 'not found' }
      })

      try {
        await runE2ECase({
          caseId: CASE_ID,
          domain: 'settings',
          suite: 'vector',
          description:
            '默认下载源失效时，用户通过“更换源下载”选择另一源完成模型安装，验证失败清理、弹窗标注失败源与换源重下的完整链路。',
          fixtures: [],
          serviceMode: 'real',
          extraEnv: {
            NCURATOR_MODELS_PATH: modelsPath,
            NCURATOR_MODELSCOPE_ENDPOINT: modelscopeServer.origin,
            NCURATOR_HF_MIRROR_ENDPOINT: huggingfaceServer.origin
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

            const errorArea = getSettingsLocator(page, modelLocator(vectorSelectors.errorPrefix))
            await errorArea.waitFor({ state: 'visible', timeout: SETTINGS_LONG_E2E_TIMEOUT_MS })
            const errorText = (await errorArea.textContent()) || ''

            const switchSourceButton = getSettingsLocator(
              page,
              modelLocator(vectorSelectors.switchSourceButtonPrefix)
            )
            await switchSourceButton.waitFor({ state: 'visible' })
            const switchButtonVisible = await switchSourceButton.isVisible()

            await waitForDirectoryRemoved(
              path.join(modelsPath, MODEL_ID),
              SETTINGS_LONG_E2E_TIMEOUT_MS
            )

            await switchSourceButton.click()
            const sourceModal = getSettingsLocator(page, vectorSelectors.sourceModal)
            await sourceModal.waitFor({ state: 'visible' })
            const failedSourceTag = getSettingsLocator(
              page,
              `${vectorSelectors.failedSourceTagPrefix}-modelscope`
            )
            await failedSourceTag.waitFor({ state: 'visible' })
            const failedTagVisible = await failedSourceTag.isVisible()

            const hfRadio = getSettingsLocator(
              page,
              `${vectorSelectors.sourceRadioPrefix}-huggingface-mirror`
            )
            await hfRadio.waitFor({ state: 'visible' })
            await hfRadio.click()
            await getSettingsLocator(page, vectorSelectors.sourceCancelButton).click()
            await sourceModal.waitFor({ state: 'hidden' })
            const failurePreservedAfterCancel = await errorArea.isVisible()
            const callsAfterCancel = (await runtime.collectSignals()).ipcInvokeEntries.filter(
              (entry) => entry.name === 'downloadModel'
            ).length
            await switchSourceButton.click()
            await sourceModal.waitFor({ state: 'visible' })
            await hfRadio.click()
            const callsBeforeConfirm = (await runtime.collectSignals()).ipcInvokeEntries.filter(
              (entry) => entry.name === 'downloadModel'
            ).length
            await getSettingsLocator(page, vectorSelectors.sourceConfirmButton).click()

            const installedBadge = getSettingsLocator(
              page,
              modelLocator(vectorSelectors.installedBadgePrefix)
            )
            await installedBadge.waitFor({
              state: 'visible',
              timeout: VECTOR_SWITCH_E2E_TIMEOUT_MS
            })
            const installedVisible = await installedBadge.isVisible()

            const signals = await runtime.collectSignals()
            const downloadCalls = signals.ipcInvokeEntries.filter(
              (entry) => entry.name === 'downloadModel'
            )

            return {
              errorText,
              failurePreservedAfterCancel,
              callsAfterCancel,
              callsBeforeConfirm,
              switchButtonVisible,
              failedTagVisible,
              installedVisible,
              downloadCallCount: downloadCalls.length,
              firstCallRepoId: downloadCalls[0]?.payload?.repoId,
              firstCallSource: downloadCalls[0]?.payload?.source,
              secondCallRepoId: downloadCalls[1]?.payload?.repoId,
              secondCallSource: downloadCalls[1]?.payload?.source
            }
          },
          assert: async (result, runtime) => {
            await runtime.assertThat(
              result.failurePreservedAfterCancel &&
                result.callsAfterCancel === 1 &&
                result.callsBeforeConfirm === 1,
              {
                name: 'source-switch-cancel-does-not-retry',
                message:
                  '取消选源保留失败状态，用户确认前不会自动换源重试，对齐 SET-VECTOR-003-AC5/AC6。',
                data: result
              }
            )
            await runtime.assertThat(result.errorText.includes('下载失败'), {
              name: 'source-switch-failure-shows-download-failed',
              message: '默认源失败后应提示“下载失败”，对齐 SET-VECTOR-003-AC2/AC3。',
              data: result
            })
            await runtime.assertThat(result.switchButtonVisible, {
              name: 'source-switch-failure-shows-switch-button',
              message: '下载失败后应展示“更换源下载”入口，对齐 SET-VECTOR-003-AC3。',
              data: result
            })
            await runtime.assertThat(result.failedTagVisible, {
              name: 'source-switch-modal-marks-failed-source',
              message: '换源弹窗应标注最近失败的源，对齐 SET-VECTOR-003-AC4。',
              data: result
            })
            await runtime.assertThat(result.installedVisible, {
              name: 'source-switch-retry-succeeds-on-selected-source',
              message: '选择新源确认后应重新下载并完成安装，对齐 SET-VECTOR-003-AC4。',
              data: result
            })
            await runtime.assertThat(result.downloadCallCount === 2, {
              name: 'source-switch-two-download-calls',
              message: '换源链路应触发两次下载：默认源一次、换源后一次。',
              data: result
            })
            await runtime.assertThat(
              result.firstCallRepoId === MODEL_ID && result.firstCallSource === undefined,
              {
                name: 'source-switch-first-call-uses-default-source',
                message: '首次下载不应携带 source，使用默认源。',
                data: result
              }
            )
            await runtime.assertThat(
              result.secondCallRepoId === MODEL_ID &&
                result.secondCallSource === 'huggingface-mirror',
              {
                name: 'source-switch-second-call-carries-selected-source',
                message: '换源后的下载应携带用户选择的 huggingface-mirror 源。',
                data: result
              }
            )
          }
        })
      } finally {
        await new Promise<void>((resolve) => modelscopeServer.server.close(() => resolve()))
        await new Promise<void>((resolve) => huggingfaceServer.server.close(() => resolve()))
        await rm(modelsPath, { recursive: true, force: true })
      }
    },
    VECTOR_SWITCH_E2E_TIMEOUT_MS
  )
})
