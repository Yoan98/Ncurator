import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { EmbeddingService } from '../../../../src/main/services/vector/EmbeddingService'
import { TransformersEmbeddingExecutor } from '../../../../src/main/services/vector/runtime/TransformersEmbeddingExecutor'
import { WorkspaceKnowledgePrepareService } from '../../../../src/main/services/workspace/WorkspaceKnowledgePrepareService'
import { prepareWorkspaceSource } from '../../../../src/main/services/workspace/worker/workspacePrepareWorker'
import { getModelsPath } from '../../../../src/main/utils/paths'
import {
  resolveOrtThreadBudget,
  toOrtSessionOptions
} from '../../../../src/main/services/vector/indexSpeed'
import { runBackendCase } from '../../../harness/backend/run-backend-case'

const spinningOf = (options: ReturnType<typeof toOrtSessionOptions> | null): string =>
  options?.extra['session.intra_op.allow_spinning'] || ''

describe('knowledge foundation', () => {
  it('index-speed-thread-budget', async () => {
    await runBackendCase({
      caseId: 'index-speed-thread-budget',
      harnessMode: 'tool-real',
      domain: 'knowledge',
      suite: 'foundation',
      description: '慢/高速必须作用在真实更新索引调用上，索引时 ORT session 随档位变化。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const budgets = {
          slow4: resolveOrtThreadBudget('slow', 4),
          slow8: resolveOrtThreadBudget('slow', 8),
          slow16: resolveOrtThreadBudget('slow', 16),
          fast4: resolveOrtThreadBudget('fast', 4),
          fast8: resolveOrtThreadBudget('fast', 8),
          fast16: resolveOrtThreadBudget('fast', 16)
        }
        const slowBudget = resolveOrtThreadBudget('slow')
        const fastBudget = resolveOrtThreadBudget('fast')
        const executor = new TransformersEmbeddingExecutor({
          modelsPath: getModelsPath(),
          modelName: 'jinaai/jina-embeddings-v2-base-zh'
        })
        const embeddingService = new EmbeddingService({ executor })
        const prepareService = new WorkspaceKnowledgePrepareService({
          embeddingService,
          documentsStore: runtime.documentsStore,
          prepareSource: prepareWorkspaceSource
        })
        const store = runtime.storageService.appSettings
        const defaultSettings = await store.get()
        const now = Date.now()
        const slowWorkspaceId = 'index-speed-slow'
        const fastWorkspaceId = 'index-speed-fast'
        const slowRoot = path.join(runtime.workspaceRoot, slowWorkspaceId)
        const fastRoot = path.join(runtime.workspaceRoot, fastWorkspaceId)
        await mkdir(slowRoot, { recursive: true })
        await mkdir(fastRoot, { recursive: true })
        await writeFile(path.join(slowRoot, 'slow.txt'), 'slow index speed\n')
        await writeFile(path.join(fastRoot, 'fast.txt'), 'fast index speed\n')
        await runtime.storageService.workspace.saveWorkspace({
          id: slowWorkspaceId,
          root_path: slowRoot,
          created_at: now,
          updated_at: now
        })
        await runtime.storageService.workspace.saveWorkspace({
          id: fastWorkspaceId,
          root_path: fastRoot,
          created_at: now,
          updated_at: now
        })

        await embeddingService.applyIndexSpeed('slow')
        const slowIndexed = await prepareService.indexLocalFile({
          workspaceId: slowWorkspaceId,
          documentId: `${slowWorkspaceId}-doc`,
          filePath: path.join(slowRoot, 'slow.txt'),
          documentName: 'slow.txt'
        })
        const appliedSlow = executor.getAppliedSessionOptions()

        const saved = await store.save({ ...defaultSettings, knowledgeIndexSpeed: 'fast' })
        await embeddingService.applyIndexSpeed('fast')
        const fastIndexed = await prepareService.indexLocalFile({
          workspaceId: fastWorkspaceId,
          documentId: `${fastWorkspaceId}-doc`,
          filePath: path.join(fastRoot, 'fast.txt'),
          documentName: 'fast.txt'
        })
        const appliedFast = executor.getAppliedSessionOptions()

        return {
          budgets,
          slowBudget,
          fastBudget,
          defaultSpeed: defaultSettings.knowledgeIndexSpeed,
          persistedSpeed: saved.knowledgeIndexSpeed,
          appliedSlow,
          appliedFast,
          slowIndexed: {
            documentId: slowIndexed.documentId,
            chunkCount: slowIndexed.chunkCount,
            usedCachedVectors: slowIndexed.usedCachedVectors
          },
          fastIndexed: {
            documentId: fastIndexed.documentId,
            chunkCount: fastIndexed.chunkCount,
            usedCachedVectors: fastIndexed.usedCachedVectors
          }
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.budgets.slow4.intraOpNumThreads === 2 &&
            result.budgets.slow4.allowSpinning === false,
          {
            name: 'slow-4-cores',
            message: '4 核慢速应为 2 线程且关闭 spinning。',
            data: result.budgets.slow4
          }
        )
        runtime.assertThat(
          result.budgets.slow8.intraOpNumThreads === 4 &&
            result.budgets.slow8.allowSpinning === false,
          {
            name: 'slow-8-cores',
            message: '8 核慢速应为 4 线程且关闭 spinning。',
            data: result.budgets.slow8
          }
        )
        runtime.assertThat(
          result.budgets.slow16.intraOpNumThreads === 8 &&
            result.budgets.slow16.allowSpinning === false,
          {
            name: 'slow-16-cores',
            message: '16 核慢速应为 8 线程且关闭 spinning。',
            data: result.budgets.slow16
          }
        )
        runtime.assertThat(
          result.budgets.fast4.intraOpNumThreads === 3 && result.budgets.fast4.allowSpinning === true,
          {
            name: 'fast-4-cores',
            message: '4 核高速应为 3 线程且开启 spinning。',
            data: result.budgets.fast4
          }
        )
        runtime.assertThat(
          result.budgets.fast8.intraOpNumThreads === 7 && result.budgets.fast8.allowSpinning === true,
          {
            name: 'fast-8-cores',
            message: '8 核高速应为 7 线程且开启 spinning。',
            data: result.budgets.fast8
          }
        )
        runtime.assertThat(
          result.budgets.fast16.intraOpNumThreads === 14 &&
            result.budgets.fast16.allowSpinning === true,
          {
            name: 'fast-16-cores',
            message: '16 核高速应为 14 线程且开启 spinning。',
            data: result.budgets.fast16
          }
        )
        runtime.assertThat(
          result.defaultSpeed === 'slow' &&
            result.persistedSpeed === 'fast' &&
            result.slowIndexed.chunkCount > 0 &&
            result.fastIndexed.chunkCount > 0 &&
            result.slowIndexed.usedCachedVectors === false &&
            result.fastIndexed.usedCachedVectors === false &&
            result.appliedSlow?.intraOpNumThreads === result.slowBudget.intraOpNumThreads &&
            spinningOf(result.appliedSlow) === '0' &&
            result.appliedFast?.intraOpNumThreads === result.fastBudget.intraOpNumThreads &&
            spinningOf(result.appliedFast) === '1' &&
            (result.appliedFast?.intraOpNumThreads || 0) >
              (result.appliedSlow?.intraOpNumThreads || 0),
          {
            name: 'index-calls-follow-speed',
            message:
              '真实 indexLocalFile 必须在慢速/高速档位下各完成一次索引；两次 embedding session 的 intraOp 与 spinning 必须等于当时档位。',
            data: {
              defaultSpeed: result.defaultSpeed,
              persistedSpeed: result.persistedSpeed,
              slowBudget: result.slowBudget,
              fastBudget: result.fastBudget,
              appliedSlow: result.appliedSlow,
              appliedFast: result.appliedFast,
              slowIndexed: result.slowIndexed,
              fastIndexed: result.fastIndexed
            }
          }
        )
      }
    })
  })
})
