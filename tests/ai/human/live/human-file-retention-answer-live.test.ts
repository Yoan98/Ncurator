import { describe, it } from 'vitest'
import { loadLiveLlmConfigFromEnv, hasLiveLlmConfigInEnv } from '../../../harness/backend/llmConfig'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import {
  HUMAN_FILE_RETENTION_USER_INPUT,
  seedFileRetentionKb
} from '../../../harness/backend/aiLiveTestData'
import { filterAiRunEventsByType } from '../testUtils'

describe('ai human live backend', () => {
  it('human-file-retention-answer-live', async () => {
    await runBackendCase({
      caseId: 'human-file-retention-answer-live',
      harnessMode: 'live',
      domain: 'ai',
      suite: 'human',
      groups: ['live'],
      description: '验证 live 模式下 human 会基于真实已选资料完成常见规则问答。',
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
        await seedFileRetentionKb(runtime)
        const runner = createHumanTestRunner(runtime)
        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: HUMAN_FILE_RETENTION_USER_INPUT
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
            message: '未提供 live 模型配置，已跳过 human live file retention case。'
          })
          return
        }

        const toolResults = filterAiRunEventsByType(result.events, 'tool_call_result')
        const deliveryText = `${result.output?.summary || ''}\n${result.output?.deliveryMarkdown || ''}`

        runtime.assertThat(
          result.output?.status === 'completed' &&
            toolResults.some((event) => event.toolName.startsWith('kb_')) &&
            /(保留|不变)/.test(deliveryText),
          {
            name: 'human-live-answers-file-retention-question-with-real-kb',
            message: 'live human simple case 应基于真实已选资料完成文件保留规则问答。',
            data: {
              toolNames: toolResults.map((event) => event.toolName),
              summary: result.output?.summary,
              deliveryMarkdown: result.output?.deliveryMarkdown
            }
          }
        )
      }
    })
  }, 600_000)
})
