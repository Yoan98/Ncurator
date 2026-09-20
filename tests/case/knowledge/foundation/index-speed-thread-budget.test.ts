import { describe, it } from 'vitest'
import { EmbeddingService } from '../../../../src/main/services/vector/EmbeddingService'
import { TransformersEmbeddingExecutor } from '../../../../src/main/services/vector/runtime/TransformersEmbeddingExecutor'
import { ensureEmbeddingReady } from '../../../../src/main/services/vector/ensureEmbeddingReady'
import { getModelsPath } from '../../../../src/main/utils/paths'
import {
  parseEmbeddingRuntimeEnv,
  resolveOrtThreadBudget,
  toEmbeddingRuntimeEnv,
  toOrtSessionOptions
} from '../../../../src/main/services/vector/indexSpeed'
import { runBackendCase } from '../../../harness/backend/run-backend-case'

describe('knowledge foundation', () => {
  it('index-speed-thread-budget', async () => {
    await runBackendCase({
      caseId: 'index-speed-thread-budget',
      harnessMode: 'tool-real',
      domain: 'knowledge',
      suite: 'foundation',
      description:
        '页面保存档位走生产 AppSettingsStore 与嵌入 executor：ORT session_options / runtime env 随档位变化，apply 后真实嵌入仍可用。',
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
        const session = {
          slow8: toOrtSessionOptions(budgets.slow8),
          fast8: toOrtSessionOptions(budgets.fast8)
        }
        const runtimeEnv = {
          slow8: toEmbeddingRuntimeEnv(budgets.slow8),
          fast8: toEmbeddingRuntimeEnv(budgets.fast8)
        }

        const executor = new TransformersEmbeddingExecutor({
          modelsPath: getModelsPath(),
          modelName: 'jinaai/jina-embeddings-v2-base-zh'
        })
        const embeddingService = new EmbeddingService({ executor })
        const store = runtime.storageService.appSettings
        const defaultSettings = await store.get()
        const saved = await store.save({ ...defaultSettings, knowledgeIndexSpeed: 'fast' })
        if (defaultSettings.knowledgeIndexSpeed !== saved.knowledgeIndexSpeed) {
          await embeddingService.applyIndexSpeed(saved.knowledgeIndexSpeed)
        }
        await ensureEmbeddingReady({ embeddingService })
        const embedded = await embeddingService.embed('索引速度')

        return {
          budgets,
          session,
          runtimeEnv,
          parsedEnv: {
            slow8: parseEmbeddingRuntimeEnv(runtimeEnv.slow8),
            fast8: parseEmbeddingRuntimeEnv(runtimeEnv.fast8)
          },
          defaultSpeed: defaultSettings.knowledgeIndexSpeed,
          persistedSpeed: saved.knowledgeIndexSpeed,
          appliedBudget: executor.getThreadBudget(),
          statusAfterSave: embeddingService.getStatus() === 'ready' ? 'ready' : embeddingService.getStatus(),
          embeddingDims: embedded.dims
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.budgets.slow4.intraOpNumThreads === 2 && result.budgets.slow4.allowSpinning === false,
          {
            name: 'slow-4-cores',
            message: '4 核慢速应为 2 线程且关闭 spinning。',
            data: result.budgets.slow4
          }
        )
        runtime.assertThat(
          result.budgets.slow8.intraOpNumThreads === 4 && result.budgets.slow8.allowSpinning === false,
          {
            name: 'slow-8-cores',
            message: '8 核慢速应为 4 线程且关闭 spinning。',
            data: result.budgets.slow8
          }
        )
        runtime.assertThat(
          result.budgets.slow16.intraOpNumThreads === 8 && result.budgets.slow16.allowSpinning === false,
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
          result.budgets.fast16.intraOpNumThreads === 14 && result.budgets.fast16.allowSpinning === true,
          {
            name: 'fast-16-cores',
            message: '16 核高速应为 14 线程且开启 spinning。',
            data: result.budgets.fast16
          }
        )
        runtime.assertThat(
          result.session.slow8.intraOpNumThreads < result.session.fast8.intraOpNumThreads &&
            result.session.slow8.extra['session.intra_op.allow_spinning'] === '0' &&
            result.session.fast8.extra['session.intra_op.allow_spinning'] === '1',
          {
            name: 'session-options-differ',
            message: '同核数下慢速与高速必须给出不同的 ORT session_options。',
            data: result.session
          }
        )
        runtime.assertThat(
          result.runtimeEnv.slow8.NCURATOR_EMBEDDING_INTRA_OP_THREADS !==
            result.runtimeEnv.fast8.NCURATOR_EMBEDDING_INTRA_OP_THREADS &&
            result.runtimeEnv.slow8.NCURATOR_EMBEDDING_ALLOW_SPINNING === '0' &&
            result.runtimeEnv.fast8.NCURATOR_EMBEDDING_ALLOW_SPINNING === '1' &&
            result.parsedEnv.slow8?.intraOpNumThreads === result.budgets.slow8.intraOpNumThreads &&
            result.parsedEnv.fast8?.intraOpNumThreads === result.budgets.fast8.intraOpNumThreads,
          {
            name: 'runtime-env-roundtrip',
            message: '子进程 env 必须随档位变化，且解析后还原为对应预算。',
            data: { runtimeEnv: result.runtimeEnv, parsedEnv: result.parsedEnv }
          }
        )
        runtime.assertThat(
          result.defaultSpeed === 'slow' &&
            result.persistedSpeed === 'fast' &&
            result.appliedBudget.allowSpinning === true &&
            result.appliedBudget.intraOpNumThreads === resolveOrtThreadBudget('fast').intraOpNumThreads &&
            result.statusAfterSave === 'ready' &&
            result.embeddingDims[1] === 768,
          {
            name: 'save-settings-applies-production-executor',
            message:
              '保存档位必须走生产 store 与 EmbeddingService.applyIndexSpeed：默认慢速，保存高速后预算写入、session 重建，且真实嵌入可用。',
            data: {
              defaultSpeed: result.defaultSpeed,
              persistedSpeed: result.persistedSpeed,
              appliedBudget: result.appliedBudget,
              statusAfterSave: result.statusAfterSave,
              embeddingDims: result.embeddingDims
            }
          }
        )
      }
    })
  })
})
