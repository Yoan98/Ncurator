import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { buildToolDecision } from '../testUtils'

describe('ai human mock-llm backend', () => {
  it('plan-memory-maintenance', async () => {
    await runBackendCase({
      caseId: 'plan-memory-maintenance',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description: '验证 plan 会跨轮保留，且状态更新会写入下一轮 prompt。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        let secondBrainSeesPlan = false
        let thirdBrainSeesUpdatedPlan = false
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
                secondBrainSeesPlan =
                  user.includes('确认 A 事项') && user.includes('确认 B 事项')
                return buildToolDecision({
                  toolName: 'update_plan',
                  args: {
                    plan: [
                      { title: '确认 A 事项', status: 'done' },
                      { title: '确认 B 事项', status: 'todo' },
                      { title: '检查是否已经满足用户诉求并能进入最终交付', status: 'todo' }
                    ]
                  },
                  summary: '确认 A 事项已完成，任务板需要跨轮重写。'
                })
              },
              ({ user }) => {
                const planEchoCount = user.split('确认 A 事项').length - 1
                thirdBrainSeesUpdatedPlan =
                  planEchoCount >= 2 && user.includes('确认 B 事项')
                return buildToolDecision({
                  toolName: 'update_plan',
                  args: {
                    plan: [
                      { title: '确认 A 事项', status: 'done' },
                      { title: '确认 B 事项', status: 'done' },
                      { title: '检查是否已经满足用户诉求并能进入最终交付', status: 'done' }
                    ]
                  },
                  summary: '任务板收尾，所有事项已完成。'
                })
              },
              {
                output: {
                  thought: { next: '所有事项已处理完，可以进入最终交付。' },
                  nextAction: { action: 'deliver' }
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
          secondBrainSeesPlan,
          thirdBrainSeesUpdatedPlan,
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.output.status === 'completed' &&
            result.secondBrainSeesPlan &&
            result.thirdBrainSeesUpdatedPlan,
          {
            name: 'plan-persists-and-updates-across-rounds',
            message:
              'plan 应作为长期任务板在下一轮真实 brain prompt 中继续存在，且更新后的任务板应写回再下一轮 transcript。',
            data: {
              secondBrainSeesPlan: result.secondBrainSeesPlan,
              thirdBrainSeesUpdatedPlan: result.thirdBrainSeesUpdatedPlan
            }
          }
        )
      }
    })
  })
})