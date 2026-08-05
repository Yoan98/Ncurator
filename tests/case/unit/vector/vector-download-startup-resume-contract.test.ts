import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, it, vi } from 'vitest'
import { EmbeddingService } from '../../../../src/main/services/vector/EmbeddingService'
import { ModelService } from '../../../../src/main/services/model/ModelService'
import { VectorModelDownloadService } from '../../../../src/main/services/model/VectorModelDownloadService'
import { TransformersEmbeddingExecutor } from '../../../../src/main/services/vector/runtime/TransformersEmbeddingExecutor'
import type {
  ModelDownloadProgress,
  ModelDownloadProgressReporter
} from '../../../../src/main/services/model/ModelService'
import { runBackendCase } from '../../../harness/backend/run-backend-case'

const ACTIVE_DOWNLOAD_SNAPSHOT_FILE = '.active-vector-download.json'
const SNAPSHOT_REPO_ID = 'jinaai/jina-embeddings-v2-base-zh'

type VectorModelDownloadServiceStatics = typeof VectorModelDownloadService & {
  instance: VectorModelDownloadService | null
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
  await fs.promises.rm(resolveSnapshotPath(), { force: true })
  if (originalModelsPath) {
    process.env.NCURATOR_MODELS_PATH = originalModelsPath
  } else {
    delete process.env.NCURATOR_MODELS_PATH
  }
  await fs.promises.rm(isolatedModelsPath, { recursive: true, force: true })
})

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

afterEach(async () => {
  vi.restoreAllMocks()
  ;(VectorModelDownloadService as VectorModelDownloadServiceStatics).instance = null
  await fs.promises.rm(resolveSnapshotPath(), { force: true })
})

describe('unit vector backend', () => {
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
