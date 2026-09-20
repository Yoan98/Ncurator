import { describe, it } from 'vitest'
import { resolveOrtThreadBudget } from '../../../../src/main/services/vector/indexSpeed'
import { runBackendCase } from '../../../harness/backend/run-backend-case'

describe('knowledge foundation', () => {
  it('index-speed-thread-budget', async () => {
    await runBackendCase({
      caseId: 'index-speed-thread-budget',
      harnessMode: 'tool-real',
      domain: 'knowledge',
      suite: 'foundation',
      description: '慢速/高速按逻辑核数映射 ORT 线程预算与 spinning。',
      fixtures: [],
      runMode: 'single',
      execute: async () => ({
        slow4: resolveOrtThreadBudget('slow', 4),
        slow8: resolveOrtThreadBudget('slow', 8),
        slow16: resolveOrtThreadBudget('slow', 16),
        fast4: resolveOrtThreadBudget('fast', 4),
        fast8: resolveOrtThreadBudget('fast', 8),
        fast16: resolveOrtThreadBudget('fast', 16)
      }),
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.slow4.intraOpNumThreads === 2 && result.slow4.allowSpinning === false,
          {
            name: 'slow-4-cores',
            message: '4 核慢速应为 2 线程且关闭 spinning。',
            data: result.slow4
          }
        )
        runtime.assertThat(
          result.slow8.intraOpNumThreads === 4 && result.slow8.allowSpinning === false,
          {
            name: 'slow-8-cores',
            message: '8 核慢速应为 4 线程且关闭 spinning。',
            data: result.slow8
          }
        )
        runtime.assertThat(
          result.slow16.intraOpNumThreads === 8 && result.slow16.allowSpinning === false,
          {
            name: 'slow-16-cores',
            message: '16 核慢速应为 8 线程且关闭 spinning。',
            data: result.slow16
          }
        )
        runtime.assertThat(
          result.fast4.intraOpNumThreads === 3 && result.fast4.allowSpinning === true,
          {
            name: 'fast-4-cores',
            message: '4 核高速应为 3 线程且开启 spinning。',
            data: result.fast4
          }
        )
        runtime.assertThat(
          result.fast8.intraOpNumThreads === 7 && result.fast8.allowSpinning === true,
          {
            name: 'fast-8-cores',
            message: '8 核高速应为 7 线程且开启 spinning。',
            data: result.fast8
          }
        )
        runtime.assertThat(
          result.fast16.intraOpNumThreads === 14 && result.fast16.allowSpinning === true,
          {
            name: 'fast-16-cores',
            message: '16 核高速应为 14 线程且开启 spinning。',
            data: result.fast16
          }
        )
      }
    })
  })
})
