import { describe, it } from 'vitest'
import { createDirectorTestRunner } from '../../../harness/backend/directorHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import { filterDirectorTaskEventsByStage } from '../testUtils'
import { buildCompleteTaskDecision } from '../../human/testUtils'

describe('ai director mock-llm backend', () => {
  it('plan-exec-serial-merge', async () => {
    await runBackendCase({
      caseId: 'plan-exec-serial-merge',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'director',
      groups: ['mock-llm'],
      description: '验证 director 在真实 plan exec 中会按顺序串行派发 human task。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const runner = createDirectorTestRunner(runtime, {
          structuredOutputScript: {
            'director.intent': [
              {
                output: {
                  mode: 'to_plan',
                  reason: '需要拆成串行子任务。'
                }
              }
            ],
            'director.plan': [
              {
                output: {
                  tasks: [
                    {
                      id: 'task-a',
                      title: 'Task A',
                      userInput: '先完成 A。'
                    },
                    {
                      id: 'task-b',
                      title: 'Task B',
                      userInput: '再完成 B。'
                    }
                  ]
                }
              }
            ],
            'human.brain': [
              {
                output: buildCompleteTaskDecision({
                  summary: 'A 已完成。',
                  reason: '先完成第一个任务。',
                  expectedOutcome: '交回 handoff。'
                })
              },
              {
                output: buildCompleteTaskDecision({
                  summary: 'B 已完成。',
                  reason: '第二个任务随后执行。',
                  expectedOutcome: '交回 handoff。'
                })
              },
              {
                output: buildCompleteTaskDecision({
                  summary: '综合已完成。',
                  reason: '所有任务均已串行完成。',
                  expectedOutcome: '输出最终结果。'
                })
              }
            ],
            'human.mouth': [
              {
                output: {
                  summary: 'A 已完成。',
                  deliveryMarkdown:
                    '# 任务交接结果\n\n## 任务完成情况\nA 已完成。\n\n## 已确认信息\n- 先完成了 task-a。\n\n## 关键证据\n- 当前无需额外工具。\n\n## 产物与引用\n无\n\n## 未决与风险\n无\n\n## 对后续任务的影响\n可继续执行 task-b。\n\n## 建议下一步\n- 进入 task-b。'
                }
              },
              {
                output: {
                  summary: 'B 已完成。',
                  deliveryMarkdown:
                    '# 任务交接结果\n\n## 任务完成情况\nB 已完成。\n\n## 已确认信息\n- 紧接着完成了 task-b。\n\n## 关键证据\n- 当前无需额外工具。\n\n## 产物与引用\n无\n\n## 未决与风险\n无\n\n## 对后续任务的影响\n可进入综合。\n\n## 建议下一步\n- 进入 synthesis。'
                }
              },
              {
                output: {
                  summary: '综合已完成。',
                  deliveryMarkdown: '# Final Answer\n\n已按顺序完成 task-a 和 task-b。'
                }
              }
            ]
          }
        })

        const state = await runner.run({
          userInput: '请按顺序执行多个子任务。'
        })

        return {
          state,
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        const planExecStarts = filterDirectorTaskEventsByStage(
          result.events,
          'task_started',
          'director_plan_exec'
        )

        runtime.assertThat(
          result.state.status === 'completed' &&
            planExecStarts.map((event) => event.taskId).join(',') === 'task-a,task-b',
          {
            name: 'director-plan-exec-stays-serial',
            message: 'director_plan_exec 应按计划顺序串行派发 human task。',
            data: {
              planExecStarts
            }
          }
        )
      }
    })
  })
})
