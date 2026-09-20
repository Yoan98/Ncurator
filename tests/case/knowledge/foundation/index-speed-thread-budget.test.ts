import { describe, it } from 'vitest'
import { EmbeddingService } from '../../../../src/main/services/vector/EmbeddingService'
import { TransformersEmbeddingExecutor } from '../../../../src/main/services/vector/runtime/TransformersEmbeddingExecutor'
import { createEmbeddingRuntimeRequestHandler } from '../../../../src/main/services/vector/runtime/embeddingRuntimeProcess'
import { ensureEmbeddingReady } from '../../../../src/main/services/vector/ensureEmbeddingReady'
import { getModelsPath } from '../../../../src/main/utils/paths'
import {
  parseEmbeddingRuntimeEnv,
  resolveOrtThreadBudget,
  toEmbeddingRuntimeEnv,
  toOrtSessionOptions
} from '../../../../src/main/services/vector/indexSpeed'
import { measureOrtSessionThreads } from '../../../harness/backend/measureOrtSessionThreads'
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
      description:
        '慢/高速必须让独立进程里真实 ORT session 的操作系统线程数随 intraOpNumThreads 变化。',
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
        const slowBudget = resolveOrtThreadBudget('slow')
        const fastBudget = resolveOrtThreadBudget('fast')
        const modelsPath = getModelsPath()
        const slowThreads = measureOrtSessionThreads({ budget: slowBudget, modelsPath })
        const fastThreads = measureOrtSessionThreads({ budget: fastBudget, modelsPath })

        const executor = new TransformersEmbeddingExecutor({
          modelsPath,
          modelName: 'jinaai/jina-embeddings-v2-base-zh'
        })
        const embeddingService = new EmbeddingService({ executor })
        const handleRuntimeRequest = createEmbeddingRuntimeRequestHandler(executor)
        const store = runtime.storageService.appSettings
        const defaultSettings = await store.get()

        const constructorBudget = executor.getThreadBudget()
        await handleRuntimeRequest({
          requestId: 'init-fast-payload',
          action: 'initialize',
          payload: fastBudget
        })
        const appliedAfterFastPayload = executor.getAppliedSessionOptions()
        const embeddedFast = await embeddingService.embed('索引速度')

        const saved = await store.save({ ...defaultSettings, knowledgeIndexSpeed: 'fast' })
        await embeddingService.applyIndexSpeed('slow')
        await ensureEmbeddingReady({ embeddingService })
        const appliedAfterSlowSwitch = executor.getAppliedSessionOptions()
        const embeddedSlow = await embeddingService.embed('索引速度')

        return {
          budgets,
          session,
          runtimeEnv,
          parsedEnv: {
            slow8: parseEmbeddingRuntimeEnv(runtimeEnv.slow8),
            fast8: parseEmbeddingRuntimeEnv(runtimeEnv.fast8)
          },
          slowThreads,
          fastThreads,
          constructorBudget,
          slowBudget,
          fastBudget,
          defaultSpeed: defaultSettings.knowledgeIndexSpeed,
          persistedSpeed: saved.knowledgeIndexSpeed,
          appliedAfterFastPayload,
          appliedAfterSlowSwitch,
          fastDims: embeddedFast.dims,
          slowDims: embeddedSlow.dims
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.slowThreads.after > result.slowThreads.before &&
            result.fastThreads.after > result.fastThreads.before &&
            result.slowThreads.intraOpNumThreads === result.slowBudget.intraOpNumThreads &&
            result.fastThreads.intraOpNumThreads === result.fastBudget.intraOpNumThreads &&
            result.fastThreads.after - result.slowThreads.after ===
              result.fastBudget.intraOpNumThreads - result.slowBudget.intraOpNumThreads,
          {
            name: 'ort-os-threads-follow-intra-op',
            message:
              '独立进程里真实 ORT session 的操作系统线程数差必须等于慢/高速 intraOpNumThreads 差。',
            data: {
              slowThreads: result.slowThreads,
              fastThreads: result.fastThreads,
              slowBudget: result.slowBudget,
              fastBudget: result.fastBudget
            }
          }
        )
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
          result.constructorBudget.intraOpNumThreads === result.slowBudget.intraOpNumThreads &&
            result.constructorBudget.allowSpinning === false &&
            result.appliedAfterFastPayload?.intraOpNumThreads ===
              result.fastBudget.intraOpNumThreads &&
            spinningOf(result.appliedAfterFastPayload) === '1',
          {
            name: 'runtime-initialize-payload-applies-fast-session',
            message:
              '子进程 initialize payload 必须覆盖默认慢速：pipeline 实际收到的 session_options 应是高速线程数并开启 spinning。',
            data: {
              constructorBudget: result.constructorBudget,
              appliedAfterFastPayload: result.appliedAfterFastPayload,
              fastBudget: result.fastBudget
            }
          }
        )
        runtime.assertThat(
          result.appliedAfterSlowSwitch?.intraOpNumThreads ===
            result.slowBudget.intraOpNumThreads &&
            spinningOf(result.appliedAfterSlowSwitch) === '0' &&
            (result.appliedAfterFastPayload?.intraOpNumThreads || 0) >
              (result.appliedAfterSlowSwitch?.intraOpNumThreads || 0),
          {
            name: 'apply-index-speed-rebuilds-session',
            message:
              'applyIndexSpeed 后必须重建 ORT session：第二次 pipeline 收到的 intraOpNumThreads 应回到慢速，且小于高速。',
            data: {
              appliedAfterFastPayload: result.appliedAfterFastPayload,
              appliedAfterSlowSwitch: result.appliedAfterSlowSwitch,
              slowBudget: result.slowBudget
            }
          }
        )
        runtime.assertThat(
          result.defaultSpeed === 'slow' &&
            result.persistedSpeed === 'fast' &&
            result.fastDims[1] === 768 &&
            result.slowDims[1] === 768,
          {
            name: 'save-settings-and-real-embed',
            message: '默认慢速，保存后 sqlite 为高速；两次真实嵌入在切换前后都可用。',
            data: {
              defaultSpeed: result.defaultSpeed,
              persistedSpeed: result.persistedSpeed,
              fastDims: result.fastDims,
              slowDims: result.slowDims
            }
          }
        )
      }
    })
  })
})
