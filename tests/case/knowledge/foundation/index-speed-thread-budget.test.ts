import { describe, it } from 'vitest'
import { EmbeddingService } from '../../../../src/main/services/vector/EmbeddingService'
import type { EmbeddingExecutor, EmbeddingThreadBudget } from '../../../../src/main/services/vector/runtime/types'
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
        '慢速/高速映射到不同的 ORT session_options 与 runtime env，保存后 applyThreadBudget 会写入预算并重启。',
      fixtures: [],
      runMode: 'single',
      execute: async () => {
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

        let appliedBudget: EmbeddingThreadBudget | null = null
        let restartCount = 0
        const executor: EmbeddingExecutor & {
          setThreadBudget: (next: EmbeddingThreadBudget) => void
        } = {
          initialize: async () => undefined,
          embed: async () => ({ data: new Float32Array(), dims: [0, 0] }),
          setThreadBudget: (next) => {
            appliedBudget = next
          },
          restart: async () => {
            restartCount += 1
          }
        }
        const service = new EmbeddingService({ executor })
        await service.initialize()
        await service.applyThreadBudget(budgets.fast8)

        return {
          budgets,
          session,
          runtimeEnv,
          parsedEnv: {
            slow8: parseEmbeddingRuntimeEnv(runtimeEnv.slow8),
            fast8: parseEmbeddingRuntimeEnv(runtimeEnv.fast8)
          },
          apply: {
            appliedBudget,
            restartCount,
            status: service.getStatus()
          }
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
          result.apply.appliedBudget?.intraOpNumThreads === result.budgets.fast8.intraOpNumThreads &&
            result.apply.appliedBudget?.allowSpinning === true &&
            result.apply.restartCount === 1 &&
            result.apply.status === 'uninitialized',
          {
            name: 'apply-thread-budget-restarts',
            message: '保存档位后必须把预算写入 runtime 并重启，使下次索引使用新 session。',
            data: result.apply
          }
        )
      }
    })
  })
})
