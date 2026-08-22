import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { filterAiRunEventsByType } from '../testUtils'
import { buildToolDecision } from '../testUtils'

describe('ai human mock-llm backend', () => {
  it('todolist-memory-maintenance', async () => {
    await runBackendCase({
      caseId: 'todolist-memory-maintenance',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description: '验证 plan 会跨轮保留，且在仍有 todo 时选择 finish 会收到强制回退提示。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        let secondBrainSeesTodolist = false
        let thirdBrainSeesIncompleteHint = false
        const runner = createHumanTestRunner(runtime, {
          structuredOutputScript: {
            'human.brain': [
              {
                output: buildToolDecision({
                  toolName: 'update_plan',
                  args: {
                    plan: [
                      { title: '确认 A 事项', status: 'todo' },
                      { title: '确认 B 事项', status: 'todo' },
                      { title: '检查是否已经满足用户诉求并能进入最终交付', status: 'todo' }
                    ]
                  },
                  summary: '先建立任务板，再继续推进。'
                })
              },
              ({ user }) => {
                secondBrainSeesTodolist =
                  user.includes('确认 A 事项') && user.includes('确认 B 事项')
                return buildToolDecision({
                  toolName: 'finish',
                  args: {},
                  summary: '故意提前收口，验证仍有 todo 时会被打回。'
                })
              },
              ({ user }) => {
                thirdBrainSeesIncompleteHint =
                  user.includes('上一轮选择了最终交付，但计划中仍有未完成事项') &&
                  user.includes('确认 B 事项') &&
                  user.includes('检查是否已经满足用户诉求并能进入最终交付')

                return buildToolDecision({
                  toolName: 'update_plan',
                  args: {
                    plan: [
                      { title: '确认 A 事项', status: 'done' },
                      { title: '确认 B 事项', status: 'done' },
                      { title: '检查是否已经满足用户诉求并能进入最终交付', status: 'done' }
                    ]
                  },
                  summary: '收到未完成 todo 的强提示后，先继续推进并把计划收尾。'
                })
              },
              {
                output: {
                  thought: { next: '所有事项已处理完，可以进入最终交付。' },
                  nextAction: { action: 'mouth' }
                }
              }
            ],
            'human.mouth': [
              {
                output: {
                  summary: 'todolist 已成功跨轮维护，并完成收口拦截验证。',
                  deliveryMarkdown:
                    '# Plan Memory\n\n已验证 plan 会在下一轮真实 prompt 中继续出现，且在仍有 todo 时选择 finish 会收到 decision hint 并返回 brain。'
                }
              }
            ]
          }
        })

        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: '请维护一个会跨轮保留的 plan。'
        })

        return {
          output,
          secondBrainSeesTodolist,
          thirdBrainSeesIncompleteHint,
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        const decisionHints = filterAiRunEventsByType(result.events, 'decision_hint')
        runtime.assertThat(
          result.output.status === 'completed' &&
            result.secondBrainSeesTodolist &&
            result.thirdBrainSeesIncompleteHint &&
            decisionHints.some(
              (event) =>
                event.code === 'brain_plan_incomplete' &&
                Array.isArray(event.detail?.pendingItems) &&
                event.detail.pendingItems.includes('确认 B 事项')
            ),
          {
            name: 'thought-todolist-persists-and-mouth-is-blocked-while-todo-remains',
            message:
              'plan 应作为长期任务板在下一轮真实 brain prompt 中继续存在，并在仍有 todo 时收到真实 decision_hint 后返回 brain。',
            data: {
              secondBrainSeesTodolist: result.secondBrainSeesTodolist,
              thirdBrainSeesIncompleteHint: result.thirdBrainSeesIncompleteHint,
              decisionHints
            }
          }
        )
      }
    })
  })
})
