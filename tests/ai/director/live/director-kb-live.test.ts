import { describe, it } from 'vitest'
import { loadLiveLlmConfigFromEnv, hasLiveLlmConfigInEnv } from '../../../harness/backend/llmConfig'
import { createDirectorTestRunner } from '../../../harness/backend/directorHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import { filterDirectorEventsByType } from '../testUtils'

describe('ai director live backend', () => {
  it('director-kb-live', async () => {
    await runBackendCase({
      caseId: 'director-kb-live',
      harnessMode: 'live',
      domain: 'ai',
      suite: 'director',
      groups: ['live'],
      description: '验证 live 模式下 director 会结合真实 KB 和真实 human 完成任务。',
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

        const runner = createDirectorTestRunner(runtime, {
          selectedDocumentIds: ['doc-1']
        })
        const state = await runner.run({
          userInput: '请基于当前知识库回答：审批被拒绝时应如何处理现有文件？必要时请先检索资料。'
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
            message: '未提供 live 模型配置，已跳过 director live KB case。'
          })
          return
        }

        const toolResults = filterDirectorEventsByType(result.events, 'tool_call_result')

        runtime.assertThat(
          result.state?.status === 'completed' &&
            toolResults.some((event) => event.toolName.startsWith('kb_')),
          {
            name: 'director-live-uses-real-kb-through-real-human',
            message: 'live director KB case 应通过真实 human 使用真实 KB 工具完成任务。',
            data: {
              toolNames: toolResults.map((event) => event.toolName),
              finalDeliveryMarkdown: result.state?.finalDeliveryMarkdown
            }
          }
        )
      }
    })
  }, 600_000)
})
