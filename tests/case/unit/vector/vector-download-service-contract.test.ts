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
const REPO_B = 'jinaai/jina-embeddings-v2-base-zh-secondary'
const ACTIVE_DOWNLOAD_SNAPSHOT_FILE = '.active-vector-download.json'
const SNAPSHOT_REPO_ID = REPO_A

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

const resolveSnapshotPath = (): string =>
  path.join(isolatedModelsPath, ACTIVE_DOWNLOAD_SNAPSHOT_FILE)

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

describe('unit vector download service contract', () => {
  it('vector-download-single-task-contract', async () => {
    await runBackendCase({
      caseId: 'vector-download-single-task-contract',
      harnessMode: 'tool-real',
      domain: 'unit',
      suite: 'vector',
      description: '向量模型下载在服务层只允许单任务进行，并对活跃任务持续上报进度字段。',
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
        let releaseFirstDownload: (() => void) | null = null
        const firstDownloadSettled = new Promise<void>((resolve) => {
          releaseFirstDownload = resolve
        })

        vi.spyOn(modelService, 'downloadModel').mockImplementation(
          async (repoId: string, reporter?: ModelDownloadProgressReporter) => {
            reporter?.({
              repoId,
              file: 'onnx/model.onnx',
              status: 'downloading',
              progress: 42,
              totalFiles: 3,
              completedFiles: 1
            })
            await firstDownloadSettled
            return { success: true }
          }
        )
        vi.spyOn(embeddingService, 'initialize').mockResolvedValue()

        const unsubscribe = service.onProgress((payload) => {
          progressEvents.push(payload)
        })

        const firstTask = service.startDownload(REPO_A)
        const secondResult = await service.startDownload(REPO_B)
        releaseFirstDownload?.()
        const firstResult = await firstTask
        unsubscribe()

        return {
          firstResult,
          secondResult,
          progressEvents,
          activeDownloadAfterFinish: service.getActiveDownload()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(result.firstResult.success === true, {
          name: 'vector-download-primary-task-completes',
          message: '首个下载任务应能在释放后正常完成，作为单任务下载契约的基线。',
          data: result
        })

        runtime.assertThat(
          result.secondResult.success === false &&
            String(result.secondResult.error || '').includes('download already running'),
          {
            name: 'vector-download-rejects-second-task-while-active',
            message: '已有下载任务时，新的下载入口不可继续触发新任务，对齐 SET-VECTOR-002-AC1。',
            data: result
          }
        )

        runtime.assertThat(
          result.progressEvents.some(
            (event) =>
              event.status === 'downloading' &&
              event.progress === 42 &&
              event.file === 'onnx/model.onnx' &&
              event.totalFiles === 3 &&
              event.completedFiles === 1
          ),
          {
            name: 'vector-download-contract-keeps-progress-channel-shape',
            message:
              '活跃下载任务应持续上报百分比、当前文件、已完成文件数和总文件数字段，对齐 SET-VECTOR-002-AC2。',
            data: result
          }
        )

        runtime.assertThat(
          result.progressEvents.some(
            (event) => event.status === 'completed' && event.progress === 100
          ),
          {
            name: 'vector-download-contract-completes-progress-stream',
            message: '下载完成后，进度事件流应能收敛到完成态，供页面结束下载中状态。',
            data: result
          }
        )

        runtime.assertThat(result.activeDownloadAfterFinish === null, {
          name: 'vector-download-clears-active-snapshot-after-finish',
          message: '下载完成后，后台下载服务不应继续保留活动下载快照。',
          data: result
        })
      }
    })
  })

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

  it('vector-download-startup-resume-contract', async () => {
    await runBackendCase({
      caseId: 'vector-download-startup-resume-contract',
      harnessMode: 'tool-real',
      domain: 'unit',
      suite: 'vector',
      description:
        'When a persisted active download snapshot exists, vector model startup initialization resumes the download in the background and clears the snapshot after completion.',
      fixtures: [],
      runMode: 'single',
      execute: async () => {
        ;(VectorModelDownloadService as VectorModelDownloadServiceStatics).instance = null
        const modelService = ModelService.getInstance()
        const embeddingService = new EmbeddingService({
          executor: new TransformersEmbeddingExecutor({
            modelsPath: isolatedModelsPath,
            modelName: SNAPSHOT_REPO_ID
          })
        })
        const service = VectorModelDownloadService.getInstance({
          modelService,
          embeddingService
        })
        const progressEvents: ModelDownloadProgress[] = []
        let releaseDownload: (() => void) | null = null
        const blockedDownload = new Promise<void>((resolve) => {
          releaseDownload = resolve
        })

        await fs.promises.mkdir(isolatedModelsPath, { recursive: true })
        await fs.promises.writeFile(
          resolveSnapshotPath(),
          JSON.stringify(
            {
              repoId: SNAPSHOT_REPO_ID,
              status: 'downloading',
              progress: 18,
              currentFile: 'onnx/model.onnx',
              totalFiles: 4,
              completedFiles: 0,
              updatedAt: Date.now()
            },
            null,
            2
          ),
          'utf8'
        )

        const downloadSpy = vi
          .spyOn(modelService, 'downloadModel')
          .mockImplementation(async (repoId: string, reporter?: ModelDownloadProgressReporter) => {
            reporter?.({
              repoId,
              file: 'onnx/model.onnx',
              status: 'downloading',
              progress: 64,
              totalFiles: 4,
              completedFiles: 2
            })
            await blockedDownload
            return { success: true }
          })
        vi.spyOn(modelService, 'isModelDownloaded').mockReturnValue(false)
        vi.spyOn(embeddingService, 'initialize').mockResolvedValue()

        const unsubscribe = service.onProgress((payload) => {
          progressEvents.push(payload)
        })

        await service.initialize()
        await waitForCondition(() => downloadSpy.mock.calls.length === 1)

        const activeDownloadDuringResume = service.getActiveDownload()
        const resumedDownloadTask = downloadSpy.mock.results[0]?.value as
          | Promise<{ success: boolean }>
          | undefined

        releaseDownload?.()
        if (resumedDownloadTask) {
          await resumedDownloadTask
        }
        await waitForCondition(() => service.getActiveDownload() === null)
        unsubscribe()

        return {
          resumedRepoId: downloadSpy.mock.calls[0]?.[0] || '',
          activeDownloadDuringResume,
          progressEvents,
          activeDownloadAfterFinish: service.getActiveDownload(),
          snapshotExistsAfterFinish: fs.existsSync(resolveSnapshotPath())
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(result.resumedRepoId === SNAPSHOT_REPO_ID, {
          name: 'vector-startup-resume-starts-saved-download',
          message:
            'When startup finds a persisted active download snapshot, it should resume the same vector model download in the background to satisfy SET-VECTOR-002-AC4.',
          data: result
        })

        runtime.assertThat(
          result.activeDownloadDuringResume?.repoId === SNAPSHOT_REPO_ID &&
            result.progressEvents.some(
              (event) =>
                event.status === 'downloading' &&
                event.file === 'onnx/model.onnx' &&
                event.progress === 64
            ),
          {
            name: 'vector-startup-resume-keeps-progress-stream',
            message:
              'A resumed startup download should continue emitting progress for the saved model so the renderer can restore background progress state, aligning with SET-VECTOR-002-AC4.',
            data: result
          }
        )

        runtime.assertThat(
          result.activeDownloadAfterFinish === null && result.snapshotExistsAfterFinish === false,
          {
            name: 'vector-startup-resume-clears-snapshot-after-success',
            message:
              'After a resumed download completes, the active snapshot should be cleared so the app does not replay a finished task on the next startup.',
            data: result
          }
        )
      }
    })
  })
})
