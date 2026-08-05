import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, it, vi } from 'vitest'
import { EmbeddingService } from '../../../../src/main/services/vector/EmbeddingService'
import { ModelService } from '../../../../src/main/services/model/ModelService'
import { VectorModelDownloadService } from '../../../../src/main/services/model/VectorModelDownloadService'
import type {
  ModelDownloadProgress,
  ModelDownloadProgressReporter
} from '../../../../src/main/services/model/ModelService'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import { TransformersEmbeddingExecutor } from '../../../../src/main/services/vector/runtime/TransformersEmbeddingExecutor'

const REPO_A = 'jinaai/jina-embeddings-v2-base-zh'

type VectorModelDownloadServiceStatics = typeof VectorModelDownloadService & {
  instance: VectorModelDownloadService | null
}

const waitForCondition = async (predicate: () => boolean, timeoutMs = 5000): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error('condition not met before timeout')
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 20)
    })
  }
}

let isolatedModelsPath = ''
let originalModelsPath = ''

beforeEach(async () => {
  originalModelsPath = process.env.NCURATOR_MODELS_PATH || ''
  isolatedModelsPath = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'ncurator-vector-contract-')
  )
  process.env.NCURATOR_MODELS_PATH = isolatedModelsPath
})

afterEach(async () => {
  vi.restoreAllMocks()
  ;(VectorModelDownloadService as VectorModelDownloadServiceStatics).instance = null
  if (originalModelsPath) {
    process.env.NCURATOR_MODELS_PATH = originalModelsPath
  } else {
    delete process.env.NCURATOR_MODELS_PATH
  }
  await fs.promises.rm(isolatedModelsPath, { recursive: true, force: true })
})

describe('unit vector backend', () => {
  it('vector-download-delete-while-active-contract', async () => {
    await runBackendCase({
      caseId: 'vector-download-delete-while-active-contract',
      harnessMode: 'tool-real',
      domain: 'unit',
      suite: 'vector',
      description:
        '下载中的向量模型允许删除：删除应中断活跃下载任务、收敛到取消态并移除模型文件，而不是返回 download in progress。',
      fixtures: [],
      runMode: 'single',
      execute: async () => {
        const modelService = ModelService.getInstance()
        const embeddingService = new EmbeddingService({
          executor: new TransformersEmbeddingExecutor({
            modelsPath: isolatedModelsPath,
            modelName: REPO_A
          })
        })
        const service = VectorModelDownloadService.getInstance({
          modelService,
          embeddingService
        })
        const progressEvents: ModelDownloadProgress[] = []

        let capturedSignal: AbortSignal | null = null
        const downloadSpy = vi
          .spyOn(modelService, 'downloadModel')
          .mockImplementation(
            async (
              repoId: string,
              reporter?: ModelDownloadProgressReporter,
              signal?: AbortSignal
            ) => {
              capturedSignal = signal || null
              reporter?.({
                repoId,
                file: 'onnx/model.onnx',
                status: 'downloading',
                progress: 42,
                totalFiles: 3,
                completedFiles: 1
              })
              await new Promise<void>((resolve, reject) => {
                if (signal?.aborted) {
                  reject(new Error('download aborted'))
                  return
                }
                signal?.addEventListener(
                  'abort',
                  () => {
                    reject(new Error('download aborted'))
                  },
                  { once: true }
                )
              })
              return { success: true }
            }
          )
        const deleteSpy = vi.spyOn(modelService, 'deleteModel').mockResolvedValue({ success: true })
        vi.spyOn(embeddingService, 'initialize').mockResolvedValue()

        const unsubscribe = service.onProgress((payload) => {
          progressEvents.push(payload)
        })

        const downloadTask = service.startDownload(REPO_A)
        await waitForCondition(() => downloadSpy.mock.calls.length === 1)

        const deleteResult = await service.deleteModel(REPO_A)
        const downloadResult = await downloadTask
        unsubscribe()

        return {
          downloadResult,
          deleteResult,
          deleteCalls: deleteSpy.mock.calls.map((call) => call[0]),
          signalAborted: Boolean(capturedSignal?.aborted),
          progressEvents,
          activeDownloadAfterFinish: service.getActiveDownload()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(result.deleteResult.success === true, {
          name: 'vector-delete-while-active-succeeds',
          message:
            '下载中的模型执行删除应成功返回，而不是拒绝 download in progress，对齐 SET-VECTOR-004-AC5。',
          data: result
        })

        runtime.assertThat(
          result.downloadResult.success === true && result.downloadResult.cancelled === true,
          {
            name: 'vector-download-task-converges-to-cancelled',
            message: '被删除中断的下载任务应收敛为取消结果，避免渲染层把取消误判为下载失败。',
            data: result
          }
        )

        runtime.assertThat(
          result.signalAborted &&
            result.deleteCalls.length === 1 &&
            result.deleteCalls[0] === REPO_A,
          {
            name: 'vector-delete-while-active-aborts-and-removes',
            message: '删除应通过 AbortSignal 中断下载引擎，并继续调用模型删除以移除已下载文件。',
            data: result
          }
        )

        runtime.assertThat(
          result.progressEvents.some((event) => event.status === 'cancelled'),
          {
            name: 'vector-delete-while-active-emits-cancelled',
            message: '取消后的进度事件流应发出 cancelled 状态，供页面退出下载中状态而不提示失败。',
            data: result
          }
        )

        runtime.assertThat(
          result.progressEvents.every((event) => event.status !== 'error'),
          {
            name: 'vector-delete-while-active-no-failure-toast',
            message: '取消路径不应下发面向失败的错误事件，保证页面不弹下载失败提示。',
            data: result
          }
        )

        runtime.assertThat(result.activeDownloadAfterFinish === null, {
          name: 'vector-delete-while-active-clears-snapshot',
          message: '删除中断下载后，后台下载服务不应继续保留活动下载快照。',
          data: result
        })
      }
    })
  })
})
