import { describe, it } from 'vitest'
import { createDirectorTestRunner } from '../../../harness/backend/directorHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import {
  filterDirectorEventsByType,
  filterDirectorTaskEventsByStage
} from '../testUtils'
import { buildCompleteTaskDecision } from '../../human/testUtils'

describe('ai director mock-llm backend', () => {
  it('plan-exec-then-synthesis', async () => {
    await runBackendCase({
      caseId: 'plan-exec-then-synthesis',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'director',
      groups: ['mock-llm'],
      description: '验证 director 在 mock-llm 模式下会通过真实 human 逐步执行 plan，然后进入 synthesis。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const runner = createDirectorTestRunner(runtime, {
          structuredOutputScript: {
            'director.intent': [
              {
                output: {
                  mode: 'to_plan',
                  reason: '当前任务适合拆解为多个子任务。'
                }
              }
            ],
            'director.plan': [
              {
                output: {
                  tasks: [
                    {
                      id: 'task-1',
                      title: 'Collect facts',
                      userInput: '请先整理第一部分事实。'
                    },
                    {
                      id: 'task-2',
                      title: 'Summarize risks',
                      userInput: '请再整理第二部分风险。'
                    }
                  ]
                }
              }
            ],
            'human.brain': [
              {
                output: buildCompleteTaskDecision({
                  summary: 'task-1 已完成。',
                  reason: '第一阶段只需直接整理结果。',
                  expectedOutcome: '返回 task handoff。'
                })
              },
              {
                output: buildCompleteTaskDecision({
                  summary: 'task-2 已完成。',
                  reason: '第二阶段只需直接整理结果。',
                  expectedOutcome: '返回 task handoff。'
                })
              },
              {
                output: buildCompleteTaskDecision({
                  summary: '综合输出已完成。',
                  reason: '所有 plan task 都已完成。',
                  expectedOutcome: '输出最终结果。'
                })
              }
            ],
            'human.mouth': [
              {
                output: {
                  summary: 'task-1 已完成。',
                  deliveryMarkdown:
                    '# 任务交接结果\n\n## 任务完成情况\ntask-1 已完成。\n\n## 已确认信息\n- 第一部分事实已整理。\n\n## 关键证据\n- 当前阶段无需额外工具。\n\n## 产物与引用\n无\n\n## 未决与风险\n无\n\n## 对后续任务的影响\n可继续执行 task-2。\n\n## 建议下一步\n- 进入下一个 plan task。'
                }
              },
              {
                output: {
                  summary: 'task-2 已完成。',
                  deliveryMarkdown:
                    '# 任务交接结果\n\n## 任务完成情况\ntask-2 已完成。\n\n## 已确认信息\n- 第二部分风险已整理。\n\n## 关键证据\n- 当前阶段无需额外工具。\n\n## 产物与引用\n无\n\n## 未决与风险\n无\n\n## 对后续任务的影响\n可进入 synthesis。\n\n## 建议下一步\n- 进行综合输出。'
                }
              },
              {
                output: {
                  summary: '综合输出已完成。',
                  deliveryMarkdown: '# Final Answer\n\n已完成 plan 执行和最终综合输出。'
                }
              }
            ]
          }
        })

        const state = await runner.run({
          userInput: '请拆解任务并逐步完成。'
        })

        return {
          state,
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        const planCreated = filterDirectorEventsByType(result.events, 'plan_created')
        const planExecStarts = filterDirectorTaskEventsByStage(
          result.events,
          'task_started',
          'director_plan_exec'
        )

        runtime.assertThat(
          result.state.status === 'completed' &&
            result.state.plan.every((task) => task.status === 'completed') &&
            planCreated.length === 1 &&
            planExecStarts.length === 2 &&
            result.state.finalDeliveryMarkdown?.includes('plan 执行') === true,
          {
            name: 'director-plan-exec-and-synthesis-run-through-real-human',
            message: 'director 应通过真实 human 逐项执行计划任务，再进入 synthesis 完成最终输出。',
            data: {
              plan: result.state.plan,
              finalDeliveryMarkdown: result.state.finalDeliveryMarkdown
            }
          }
        )
      }
    })
  })
})
