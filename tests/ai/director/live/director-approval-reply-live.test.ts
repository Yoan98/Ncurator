import { describe, it } from 'vitest'
import { loadLiveLlmConfigFromEnv, hasLiveLlmConfigInEnv } from '../../../harness/backend/llmConfig'
import { createDirectorTestRunner } from '../../../harness/backend/directorHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import {
  DIRECTOR_APPROVAL_REPLY_USER_INPUT,
  seedFileRetentionKb
} from '../../../harness/backend/aiLiveTestData'
import { filterDirectorEventsByType, filterDirectorTaskEventsByStage } from '../testUtils'

describe('ai director live backend', () => {
  it('director-approval-reply-live', async () => {
    await runBackendCase({
      caseId: 'director-approval-reply-live',
      harnessMode: 'live',
      domain: 'ai',
      suite: 'director',
      groups: ['live'],
      description: '验证 live 模式下 director 会把常见资料问答回复任务走成真实 human-first 路径。',
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
        await seedFileRetentionKb(runtime)
        const runner = createDirectorTestRunner(runtime)
        const state = await runner.run({
          userInput: DIRECTOR_APPROVAL_REPLY_USER_INPUT
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
            message: '未提供 live 模型配置，已跳过 director live approval reply case。'
          })
          return
        }

        const directTaskStarts = filterDirectorTaskEventsByStage(
          result.events,
          'task_started',
          'director_direct_human_exec'
        )
        const planCreatedEvents = filterDirectorEventsByType(result.events, 'plan_created')
        const toolResults = filterDirectorEventsByType(result.events, 'tool_call_result')

        runtime.assertThat(
          result.state?.status === 'completed' &&
            directTaskStarts.length === 1 &&
            planCreatedEvents.length === 0 &&
            toolResults.some((event) => event.toolName.startsWith('kb_')) &&
            typeof result.state?.finalDeliveryMarkdown === 'string' &&
            result.state.finalDeliveryMarkdown.length > 0,
          {
            name: 'director-live-runs-direct-human-reply-for-approval-question',
            message: 'live director simple case 应直接走 human-first 路径完成审批回复任务。',
            data: {
              finalDeliveryMarkdown: result.state?.finalDeliveryMarkdown,
              directTaskStarts,
              toolNames: toolResults.map((event) => event.toolName)
            }
          }
        )
      }
    })
  })
})
