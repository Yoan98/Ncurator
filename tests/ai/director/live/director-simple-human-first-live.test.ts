import { describe, it } from 'vitest'
import { loadLiveLlmConfigFromEnv, hasLiveLlmConfigInEnv } from '../../../harness/backend/llmConfig'
import { createDirectorTestRunner } from '../../../harness/backend/directorHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import { filterDirectorTaskEventsByStage } from '../testUtils'

describe('ai director live backend', () => {
  it('director-simple-human-first-live', async () => {
    await runBackendCase({
      caseId: 'director-simple-human-first-live',
      harnessMode: 'live',
      domain: 'ai',
      suite: 'director',
      groups: ['live'],
      description: '验证 live 模式下 director 会通过真实 human-first 路径完成简单任务。',
      fixtures: [],
      runMode: 'single',
      runtimeModelName: hasLiveLlmConfigInEnv('primary')
        ? loadLiveLlmConfigFromEnv('primary').model_name
        : null,
      execute: async (runtime) => {
        if (!hasLiveLlmConfigInEnv('primary')) {
          return {
            skipped: true,
            state: null,
            events: []
          }
        }

        await runtime.seedLlmConfig(loadLiveLlmConfigFromEnv('primary'))
        const runner = createDirectorTestRunner(runtime)
        const state = await runner.run({
          userInput: '这是一个简单任务。请读取当前工作区路径并给出简短答复。'
        })

        return {
          skipped: false,
          state,
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        if (result.skipped) {
          runtime.assertThat(true, {
            name: 'live-config-not-provided',
            message: '未提供 live 模型配置，已跳过 director live direct case。'
          })
          return
        }

        const directTaskStarts = filterDirectorTaskEventsByStage(
          result.events,
          'task_started',
          'director_direct_human_exec'
        )

        runtime.assertThat(
          result.state?.status === 'completed' &&
            directTaskStarts.length === 1 &&
            typeof result.state?.finalDeliveryMarkdown === 'string' &&
            result.state.finalDeliveryMarkdown.length > 0,
          {
            name: 'director-live-runs-real-human-first-path',
            message: 'live director simple case 应走真实 human-first 路径并产出最终结果。',
            data: {
              finalDeliveryMarkdown: result.state?.finalDeliveryMarkdown,
              directTaskStarts
            }
          }
        )
      }
    })
  })
})
