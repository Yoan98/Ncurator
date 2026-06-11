import { describe, it } from 'vitest'
import { createUtilityToolHarness } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

type WaitTimeResult = {
  waitedMs: number
}

describe('ai tool utility backend', () => {
  it('wait-time-contract', async () => {
    await runBackendCase({
      caseId: 'wait-time-contract',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['utility'],
      description: '验证 wait_time 会等待指定时长并返回实际等待毫秒数。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const harness = createUtilityToolHarness(runtime)
        const startedAt = Date.now()
        const result = await harness.invoke<WaitTimeResult>('wait_time', {
          seconds: 0.05
        })
        return {
          result,
          wallMs: Date.now() - startedAt
        }
      },
      assert: async (output, runtime) => {
        runtime.assertThat(output.result.waitedMs >= 40 && output.wallMs >= 40, {
          name: 'wait-time-returns-observed-delay',
          message: 'wait_time 应返回实际等待毫秒数，且墙钟时间应至少接近请求时长。',
          data: output
        })
      }
    })
  })
})
