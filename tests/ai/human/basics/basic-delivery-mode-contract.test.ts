import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import { createCapturingDeliveryOverride } from '../testUtils'

describe('ai human basics backend', () => {
  it('basic-delivery-mode-contract', async () => {
    await runBackendCase({
      caseId: 'basic-delivery-mode-contract',
      domain: 'ai',
      suite: 'human',
      groups: ['basics'],
      description: '验证 user_answer、task_handoff、context_note 三种 deliveryMode 的结果契约。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const runForMode = async (
          deliveryMode: 'user_answer' | 'task_handoff' | 'context_note'
        ) => {
          const delivery = createCapturingDeliveryOverride({
            buildMarkdown: ''
          })
          const runner = createHumanTestRunner(runtime, {
            humanReasonOverrides: [
              {
                output: {
                  memoryOps: [
                    {
                      op: 'add',
                      field: 'evidences',
                      value: {
                        id: `evidence-${deliveryMode}`,
                        toolName: 'kb_hybrid_search_chunks',
                        summary: `${deliveryMode} 模式下已定位到可复用依据。`,
                        sourceType: 'tool_result',
                        rawRef: `chunk-${deliveryMode}`
                      }
                    },
                    {
                      op: 'add',
                      field: 'facts',
                      value: {
                        id: `fact-${deliveryMode}`,
                        summary: `${deliveryMode} 模式下已整理出稳定结论。`,
                        evidenceIds: [`evidence-${deliveryMode}`]
                      }
                    },
                    {
                      op: 'add',
                      field: 'openQuestions',
                      value: `${deliveryMode} 模式下仍待人工确认一个后续问题。`
                    }
                  ],
                  decision: {
                    summary: `按 ${deliveryMode} 模式组织最终交付。`,
                    reason: '验证 mouth 在不同 deliveryMode 下的结构化结果契约。',
                    expectedOutcome: '最终 deliveryMarkdown 应严格符合对应模式。'
                  },
                  nextAction: {
                    action: 'mouth'
                  }
                }
              }
            ],
            humanDeliveryOverride: delivery.override
          })

          return await runner.run(
            {
              taskId: `${runtime.taskId}-${deliveryMode}`,
              userInput: `请以 ${deliveryMode} 模式输出最终结果。`
            },
            {
              deliveryMode
            }
          )
        }

        return {
          userAnswer: await runForMode('user_answer'),
          taskHandoff: await runForMode('task_handoff'),
          contextNote: await runForMode('context_note')
        }
      },
      assert: async (result, runtime) => {
        const taskHandoffHeadings = [
          '# 子任务交付',
          '## 本任务结论',
          '## 已完成',
          '## 关键事实',
          '## 关键证据',
          '## 产物与引用',
          '## 未决与风险',
          '## 对后续任务的影响',
          '## 建议下一步'
        ]
        const contextNoteHeadings = [
          '# 上下文补充结果',
          '## 本轮结论',
          '## 可复用证据',
          '## 当前边界',
          '## 未决项',
          '## 建议补充方向'
        ]

        runtime.assertThat(
          result.userAnswer.status === 'completed' &&
            result.userAnswer.deliveryMarkdown?.startsWith('# 处理结果') === true &&
            !result.userAnswer.deliveryMarkdown?.includes('# 子任务交付') &&
            !result.userAnswer.deliveryMarkdown?.includes('# 上下文补充结果'),
          {
            name: 'user-answer-mode-keeps-end-user-shape',
            message: 'user_answer 模式应生成面向最终用户的自然结果，不应混入 task_handoff 或 context_note 的固定标题。',
            data: {
              deliveryMarkdown: result.userAnswer.deliveryMarkdown
            }
          }
        )

        runtime.assertThat(
          result.taskHandoff.status === 'completed' &&
            taskHandoffHeadings.every((heading) =>
              result.taskHandoff.deliveryMarkdown?.includes(heading)
            ),
          {
            name: 'task-handoff-mode-uses-fixed-handoff-sections',
            message: 'task_handoff 模式应严格输出固定交接章节，保证 human 与 director 的交付边界稳定。',
            data: {
              deliveryMarkdown: result.taskHandoff.deliveryMarkdown
            }
          }
        )

        runtime.assertThat(
          result.contextNote.status === 'completed' &&
            contextNoteHeadings.every((heading) =>
              result.contextNote.deliveryMarkdown?.includes(heading)
            ) &&
            !result.contextNote.deliveryMarkdown?.includes('# 子任务交付'),
          {
            name: 'context-note-mode-uses-fixed-context-sections',
            message: 'context_note 模式应输出固定的上下文补充结构，且不与 task_handoff 章节混淆。',
            data: {
              deliveryMarkdown: result.contextNote.deliveryMarkdown
            }
          }
        )
      }
    })
  })
})
