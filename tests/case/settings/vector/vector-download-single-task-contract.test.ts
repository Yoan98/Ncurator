import { afterEach, describe, it, vi } from 'vitest'
import { EmbeddingService } from '../../../../src/main/services/vector/EmbeddingService'
import { ModelService } from '../../../../src/main/services/model/ModelService'
import { VectorModelDownloadService } from '../../../../src/main/services/model/VectorModelDownloadService'
import type {
  ModelDownloadProgress,
  ModelDownloadProgressReporter
} from '../../../../src/main/services/model/ModelService'
import { runBackendCase } from '../../../harness/backend/run-backend-case'

const REPO_A = 'jinaai/jina-embeddings-v2-base-zh'
const REPO_B = 'jinaai/jina-embeddings-v2-base-zh-secondary'

type VectorModelDownloadServiceStatics = typeof VectorModelDownloadService & {
  instance: VectorModelDownloadService | null
}

afterEach(() => {
  vi.restoreAllMocks()
  ;(VectorModelDownloadService as VectorModelDownloadServiceStatics).instance = null
})

describe('settings vector backend', () => {
  it('vector-download-single-task-contract', async () => {
    await runBackendCase({
      caseId: 'vector-download-single-task-contract',
      harnessMode: 'tool-real',
      domain: 'settings',
      suite: 'vector',
      description: '向量模型下载在服务层只允许单任务进行，并对活跃任务持续上报进度字段。',
      fixtures: [],
      runMode: 'single',
      execute: async () => {
        const modelService = ModelService.getInstance()
        const embeddingService = EmbeddingService.getInstance()
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
})
