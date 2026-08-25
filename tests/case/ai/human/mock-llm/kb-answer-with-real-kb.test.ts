import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import {
  buildCompleteTaskDecision,
  buildToolDecision,
  filterAiRunEventsByType,
  readLatestToolResultDataFromEvents
} from '../testUtils'

describe('ai human mock-llm backend', () => {
  it('kb-answer-with-real-kb', async () => {
    await runBackendCase({
      caseId: 'kb-answer-with-real-kb',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description:
        '验证 mock-llm 模式下 human 的 KB 回答仍通过真实 KB 存储、embedding 与检索代码执行。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
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
          },
          {
            id: 'doc-2',
            name: 'Owner Notes.md',
            chunks: [
              {
                id: 'chunk-2',
                text: '风险 owner 当前是运营负责人 Alice。'
              }
            ]
          }
        ])

        const runner = createHumanTestRunner(runtime, {
          structuredOutputScript: {
            'human.brain': [
              {
                output: buildToolDecision({
                  toolName: 'kb_search',
                  args: {
                    queryText: '审批被拒绝 保留现有文件',
                    strategy: 'keyword',
                    limit: 5
                  },
                  summary: '执行真实 KB 搜索'
                })
              },
              {
                output: buildCompleteTaskDecision({
                  summary: '已拿到 KB 证据。',
                  deliveryMarkdown: '# KB Answer\n\n审批被拒绝时应保留现有文件不变。'
                })
              }
            ]
          }
        })

        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: '请根据当前知识库说明审批被拒绝时应如何处理现有文件。'
        })

        return {
          output,
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        const toolResults = filterAiRunEventsByType(result.events, 'tool_call_result')
        const kbResult = readLatestToolResultDataFromEvents<{
          items: Array<{ document_id?: string; text: string }>
          total: number
        }>(toolResults, 'kb_search')

        runtime.assertThat(
          result.output.status === 'completed' &&
            kbResult.items.some((row) => row.document_id === 'doc-1') &&
            filterAiRunEventsByType(result.events, 'tool_call_result').some(
              (event) => event.toolName === 'kb_search'
            ),
          {
            name: 'human-kb-answer-uses-real-kb-runtime',
            message: 'KB 回答 case 应通过真实 KB 检索拿到证据，并完成后续最终交付。',
            data: {
              kbResult
            }
          }
        )
      }
    })
  })
})
