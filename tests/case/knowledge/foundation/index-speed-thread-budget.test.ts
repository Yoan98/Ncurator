import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'vitest'
import { getModelsPath } from '../../../../src/main/utils/paths'
import {
  resolveOrtThreadBudget,
  toOrtSessionOptions
} from '../../../../src/main/services/vector/indexSpeed'
import { runBackendCase } from '../../../harness/backend/run-backend-case'

const PROBE_PATH = fileURLToPath(
  new URL('../../../harness/backend/measure-index-speed-threads.mjs', import.meta.url)
)
const PROBE_PREFIX = 'NCURATOR_THREAD_PROBE:'

type ThreadProbeResult = {
  before: number
  after: number
  delta: number
  dims: unknown
}

const parseProbeResult = (stdout: string): ThreadProbeResult => {
  const line = stdout
    .split('\n')
    .map((item) => item.trim())
    .find((item) => item.startsWith(PROBE_PREFIX))
  if (!line) {
    throw new Error(`thread probe did not print result: ${stdout}`)
  }
  return JSON.parse(line.slice(PROBE_PREFIX.length)) as ThreadProbeResult
}

const measureIndexSpeedThreads = (speed: 'slow' | 'fast'): ThreadProbeResult => {
  const budget = resolveOrtThreadBudget(speed)
  const result = spawnSync(
    process.execPath,
    [
      PROBE_PATH,
      JSON.stringify({
        modelsPath: getModelsPath(),
        sessionOptions: toOrtSessionOptions(budget)
      })
    ],
    {
      encoding: 'utf8',
      timeout: 180_000,
      env: { ...process.env }
    }
  )
  if (result.status !== 0) {
    throw new Error(
      `thread probe failed for ${speed}: ${result.stderr || result.stdout || result.error?.message}`
    )
  }
  return parseProbeResult(result.stdout)
}

describe('knowledge foundation', () => {
  it('index-speed-thread-budget', async () => {
    await runBackendCase({
      caseId: 'index-speed-thread-budget',
      harnessMode: 'tool-real',
      domain: 'knowledge',
      suite: 'foundation',
      description:
        '慢/高速必须在独立 Node 进程的真实 embedding session 上改变操作系统线程数。',
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
        const slowBudget = resolveOrtThreadBudget('slow')
        const fastBudget = resolveOrtThreadBudget('fast')
        const slowThreads = measureIndexSpeedThreads('slow')
        const fastThreads = measureIndexSpeedThreads('fast')
        return {
          budgets,
          slowBudget,
          fastBudget,
          slowThreads,
          fastThreads
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
          result.slowThreads.delta >= result.slowBudget.intraOpNumThreads &&
            result.fastThreads.delta >= result.fastBudget.intraOpNumThreads &&
            result.fastThreads.delta - result.slowThreads.delta ===
              result.fastBudget.intraOpNumThreads - result.slowBudget.intraOpNumThreads &&
            result.fastThreads.after > result.slowThreads.after,
          {
            name: 'index-session-os-threads-follow-speed',
            message:
              '独立 Node 进程里真实 embedding session 的操作系统线程增量必须不少于该档 intraOp；高速增量大于慢速，且两档增量之差等于 intraOp 之差。',
            data: {
              slowBudget: result.slowBudget,
              fastBudget: result.fastBudget,
              slowThreads: result.slowThreads,
              fastThreads: result.fastThreads
            }
          }
        )
      }
    })
  })
})
