import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { buildCompleteTaskDecision, filterAiRunEventsByType } from '../testUtils'

describe('ai human mock-llm backend', () => {
  it('brain-output-schema-invalid-retry', async () => {
    await runBackendCase({
      caseId: 'brain-output-schema-invalid-retry',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description:
        '验证 brain hand plan schema 不合法时会产出 decision_hint 并在纠偏后继续完成任务。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        let retryBrainPrompt = ''
        const runner = createHumanTestRunner(runtime, {
          structuredOutputScript: {
            'human.brain': [
              {
                output: {
                  thought: {
                    next: '先给一个错误的 hand plan'
                  },
                  nextAction: {
                    action: 'hand',
                    calls: [
                      {
                        toolName: 'docx_edit',
                        args: {
                          sourcePath: 'report.docx',
                          actions: [
                            {
                              type: 'insert_blocks',
                              blocks: [
                                {
                                  type: 'paragraph',
                                  text: 'hello'
                                }
                              ],
                              unexpected: true
                            }
                          ]
                        }
                      }
                    ]
                  }
                }
              },
              (input) => {
                retryBrainPrompt = input.user
                return buildCompleteTaskDecision({
                  summary: '收到 decision_hint 后直接收尾。'
                })
              }
            ],
            'human.mouth': [
              {
                output: {
                  summary: '纠偏后完成任务。',
                  deliveryMarkdown: '已通过 decision_hint 完成纠偏。'
                }
              }
            ]
          }
        })

        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: '请测试 brain schema 错误纠偏'
        })

        return {
          output,
          events: runtime.eventCollector.snapshot(),
          retryBrainPrompt
        }
      },
      assert: async (result, runtime) => {
        const toolResults = filterAiRunEventsByType(result.events, 'tool_call_result')
        const docxEditErrors = toolResults.filter(
          (event) => event.toolName === 'docx_edit' && event.result?.ok === false
        )
        runtime.assertThat(
          result.output.status === 'completed' &&
            docxEditErrors.length >= 1 &&
            result.retryBrainPrompt.includes('docx_edit'),
          {
            name: 'invalid-hand-args-produce-tool-error-then-recover',
            message:
              'brain 的 hand 调用参数不合法时，应通过工具自身 schema 校验产出失败结果，并在纠偏后继续完成任务。',
            data: {
              output: result.output,
              docxEditErrorCount: docxEditErrors.length,
              retryBrainPrompt: result.retryBrainPrompt
            }
          }
        )
      }
    })
  })
})
