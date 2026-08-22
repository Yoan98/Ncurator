import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { buildToolDecision } from '../testUtils'

describe('ai human mock-llm backend', () => {
  it('brain-memory-write-boundary', async () => {
    await runBackendCase({
      caseId: 'brain-memory-write-boundary',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description:
        '验证真实 graph 中第一轮 brain 写入的 plan memory 会在下一轮真实 prompt 中继续可见。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        let secondBrainSeesMemory = false
        const runner = createHumanTestRunner(runtime, {
          structuredOutputScript: {
            'human.brain': [
              {
                output: buildToolDecision({
                  toolName: 'update_plan',
                  args: {
                    plan: [
                      {
                        title: '确认最终负责人',
                        status: 'todo',
                        evidence: '知识库显示项目上线前必须执行复核'
                      },
                      {
                        title: '检查是否已经满足用户诉求并能进入最终交付',
                        status: 'todo'
                      }
                    ]
                  },
                  summary: '先建立计划，让 plan 进入下一轮 prompt。'
                })
              },
              ({ user }) => {
                secondBrainSeesMemory =
                  user.includes('项目上线前必须执行复核') && user.includes('确认最终负责人')
                return buildToolDecision({
                  toolName: 'update_plan',
                  args: {
                    plan: [
                      {
                        title: '确认最终负责人',
                        status: 'done',
                        evidence: '第二轮真实 brain prompt 中再次读到了第一轮写入的计划'
                      },
                      {
                        title: '检查是否已经满足用户诉求并能进入最终交付',
                        status: 'done'
                      }
                    ]
                  },
                  summary: 'memory 已成功跨轮保持。'
                })
              },
              {
                output: {
                  thought: { next: '计划全部完成，进入最终交付。' },
                  nextAction: { action: 'mouth' }
                }
              }
            ],
            'human.mouth': [
              {
                output: {
                  summary: 'memory 已成功跨轮保持。',
                  deliveryMarkdown: '# Memory\n\n已验证 memory 会在下一轮真实 prompt 中继续出现。'
                }
              }
            ]
          }
        })

        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: '请写入记忆并在下一轮继续读取。'
        })

        return {
          output,
          secondBrainSeesMemory
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(result.output.status === 'completed' && result.secondBrainSeesMemory, {
          name: 'stable-memory-patch-persists-across-real-graph-rounds',
          message: 'plan 写入的任务推进记忆应在下一轮真实 brain prompt 中继续存在。',
          data: {
            secondBrainSeesMemory: result.secondBrainSeesMemory
          }
        })
      }
    })
  })
})
