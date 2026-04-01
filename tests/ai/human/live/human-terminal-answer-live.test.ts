import { describe, it } from 'vitest'
import { loadLiveLlmConfigFromEnv, hasLiveLlmConfigInEnv } from '../../../harness/backend/llmConfig'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import { filterAiRunEventsByType } from '../testUtils'

describe('ai human live backend', () => {
  it('human-terminal-answer-live', async () => {
    await runBackendCase({
      caseId: 'human-terminal-answer-live',
      harnessMode: 'live',
      domain: 'ai',
      suite: 'human',
      groups: ['live'],
      description: '验证 live 模式下 human 会通过真实 chatStructured 和真实 terminal 工具完成简单任务。',
      fixtures: [],
      runMode: 'single',
      runtimeModelName: hasLiveLlmConfigInEnv('primary')
        ? loadLiveLlmConfigFromEnv('primary').model_name
        : null,
      execute: async (runtime) => {
        if (!hasLiveLlmConfigInEnv('primary')) {
          return {
            skipped: true,
            output: null,
            events: []
          }
        }

        await runtime.seedLlmConfig(loadLiveLlmConfigFromEnv('primary'))
        const runner = createHumanTestRunner(runtime)
        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: '请读取当前工作区路径，并给我一个简短答复。必要时请使用真实工具。'
        })

        return {
          skipped: false,
          output,
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        if (result.skipped) {
          runtime.assertThat(true, {
            name: 'live-config-not-provided',
            message: '未提供 live 模型配置，已跳过 human live terminal case。'
          })
          return
        }

        const toolResults = filterAiRunEventsByType(result.events, 'tool_call_result')

        runtime.assertThat(
          result.output?.status === 'completed' &&
            toolResults.some((event) => event.toolName === 'terminal_run_command'),
          {
            name: 'human-live-uses-real-terminal-tool',
            message: 'live human case 应通过真实 chatStructured 与真实 terminal 工具完成任务。',
            data: {
              toolNames: toolResults.map((event) => event.toolName),
              summary: result.output?.summary
            }
          }
        )
      }
    })
  })
})
