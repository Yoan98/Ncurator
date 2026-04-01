import { describe, it } from 'vitest'
import { loadLiveLlmConfigFromEnv, hasLiveLlmConfigInEnv } from '../../../harness/backend/llmConfig'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import { filterAiRunEventsByType } from '../testUtils'

describe('ai human live backend', () => {
  it('human-kb-answer-live', async () => {
    await runBackendCase({
      caseId: 'human-kb-answer-live',
      harnessMode: 'live',
      domain: 'ai',
      suite: 'human',
      groups: ['live'],
      description: '验证 live 模式下 human 会通过真实知识库存储、embedding 与检索工具完成回答。',
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
        await runtime.seedKb([
          {
            id: 'doc-1',
            name: 'Risk Playbook.md',
            chunks: [
              {
                id: 'chunk-1',
                text: '审批被拒绝时必须保留现有文件不变。'
              }
            ]
          }
        ])

        const runner = createHumanTestRunner(runtime, {
          selectedDocumentIds: ['doc-1']
        })
        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: '请只根据当前知识库回答：审批被拒绝时应如何处理现有文件？必要时请先检索知识库。'
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
            message: '未提供 live 模型配置，已跳过 human live KB case。'
          })
          return
        }

        const toolResults = filterAiRunEventsByType(result.events, 'tool_call_result')

        runtime.assertThat(
          result.output?.status === 'completed' &&
            toolResults.some((event) => event.toolName.startsWith('kb_')),
          {
            name: 'human-live-uses-real-kb-tooling',
            message: 'live human KB case 应通过真实 chatStructured 和真实 KB 工具完成回答。',
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
