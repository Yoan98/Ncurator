import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import {
  buildCompleteTaskDecision,
  filterAiRunEventsByType
} from '../testUtils'

describe('ai human mock-llm backend', () => {
  it('brain-output-schema-invalid-retry', async () => {
    await runBackendCase({
      caseId: 'brain-output-schema-invalid-retry',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description: '验证 brain hand plan schema 不合法时会产出 decision_hint 并在纠偏后继续完成任务。',
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
                          actions: [{
                            type: 'create_document',
                            blocks: [
                            {
                              type: 'paragraph',
                              text: 'hello'
                            }
                          ],
                            unexpected: true
                          }]
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
        const decisionHints = filterAiRunEventsByType(result.events, 'decision_hint')
        const thinkingStarted = result.events.filter(
          (event) =>
            event.type === 'assistant_process_group_started' && event.display.kind === 'thinking'
        )
        const thinkingCompleted = result.events.filter(
          (event) =>
            event.type === 'assistant_process_group_completed' &&
            event.display.kind === 'thinking'
        )
        const schemaHintIndex = result.events.findIndex(
          (event) =>
            event.type === 'decision_hint' &&
            event.source === 'hand' &&
            event.code === 'hand_call_invalid'
        )
        const lastThinkingCompletedBeforeHint = result.events
          .slice(0, schemaHintIndex)
          .some(
            (event) =>
              event.type === 'assistant_process_group_completed' &&
              event.display.kind === 'thinking'
          )
        runtime.assertThat(
          result.output.status === 'completed' &&
            thinkingStarted.length === 2 &&
            thinkingCompleted.length === 2 &&
            lastThinkingCompletedBeforeHint &&
            result.retryBrainPrompt.includes('- 类型：hand') &&
            result.retryBrainPrompt.includes('- 工具：`docx_edit`') &&
            result.retryBrainPrompt.includes('参数：') &&
            result.retryBrainPrompt.includes('返回：') &&
            result.retryBrainPrompt.includes('<decision_hint>') &&
            decisionHints.some(
              (event) =>
                event.source === 'hand' &&
                event.code === 'hand_call_invalid' &&
                Array.isArray((event.detail as { invalidCalls?: unknown[] })?.invalidCalls)
            ),
          {
            name: 'hand-schema-invalid-produces-record-then-decision-hint',
            message: 'brain 的 hand plan 不合法时，应先进入 hand 产生失败调用记录，再产出 hand_call_invalid 并继续完成任务。',
            data: {
              output: result.output,
              decisionHints,
              thinkingStartedCount: thinkingStarted.length,
              thinkingCompletedCount: thinkingCompleted.length,
              retryBrainPrompt: result.retryBrainPrompt
            }
          }
        )
      }
    })
  })
})
