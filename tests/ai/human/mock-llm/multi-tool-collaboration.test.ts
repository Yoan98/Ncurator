import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import {
  buildCompleteTaskDecision,
  filterAiRunEventsByType
} from '../testUtils'

describe('ai human mock-llm backend', () => {
  it('multi-tool-collaboration', async () => {
    await runBackendCase({
      caseId: 'multi-tool-collaboration',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description: '验证 mock-llm 模式下 human 会通过真实 hand 并行执行多工具协作。',
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
          }
        ])

        const runner = createHumanTestRunner(runtime, {
          structuredOutputScript: {
            'human.brain': [
              {
                output: {
                  decision: {
                    summary: '并行执行 terminal 与 KB 工具',
                    reason: '两个动作都属于只读且可以并行。',
                    expectedOutcome: '一次 hand 同时拿到工作区路径和资料范围。'
                  },
                  nextAction: {
                    action: 'hand',
                    toolUsePlan: {
                      mode: 'parallel',
                      calls: [
                        {
                          toolName: 'terminal_run',
                          args: {
                            command: 'pwd'
                          }
                        },
                        {
                          toolName: 'kb_list_documents',
                          args: {}
                        }
                      ]
                    }
                  }
                }
              },
              {
                output: buildCompleteTaskDecision({
                  summary: '多工具协作已完成。',
                  reason: '并行工具调用已经带回结果。',
                  expectedOutcome: '进入最终交付。'
                })
              }
            ],
            'human.mouth': [
              {
                output: {
                  summary: '多工具协作已完成。',
                  deliveryMarkdown: '# Multi Tool\n\n已完成真实并行工具协作。'
                }
              }
            ]
          }
        })

        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: '请并行读取工作区路径并列出知识库文档。'
        })

        return {
          output,
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        const toolResults = filterAiRunEventsByType(result.events, 'tool_call_result')
        const toolNames = toolResults.map((event) => event.toolName)

        runtime.assertThat(
          result.output.status === 'completed' &&
            toolNames.includes('terminal_run') &&
            toolNames.includes('kb_list_documents'),
          {
            name: 'human-can-execute-real-parallel-multi-tool-batch',
            message: 'human 应通过真实 hand 节点执行一次并行多工具协作。',
            data: {
              toolNames
            }
          }
        )
      }
    })
  }, 600_000)
})
