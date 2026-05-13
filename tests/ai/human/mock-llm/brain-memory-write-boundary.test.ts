import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import { buildCompleteTaskDecision } from '../testUtils'

describe('ai human mock-llm backend', () => {
  it('brain-memory-write-boundary', async () => {
    await runBackendCase({
      caseId: 'brain-memory-write-boundary',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description: '验证真实 graph 中第一轮 brain 写入的 thought memory 会在下一轮真实 prompt 中继续可见。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        let secondBrainSeesMemory = false
        const runner = createHumanTestRunner(runtime, {
          structuredOutputScript: {
            'human.brain': [
              {
                output: {
                  thought: {
                    next: '先学习一个 skill，让 memory 进入下一轮 prompt。',
                    todolist: [
                      {
                        item: '确认最终负责人',
                        status: 'todo'
                      },
                      {
                        item: '检查是否已经满足用户诉求并能进入最终交付',
                        status: 'todo'
                      }
                    ],
                    progressionSummary:
                      '已根据用户诉求建立初始行动路径。当前形成的结论是项目上线前需要执行复核，证据是知识库显示上线前必须执行复核；当前没有失败事项。'
                  },
                  nextAction: {
                    action: 'learning',
                    wantLearnSkillIds: ['docx-read']
                  }
                }
              },
              ({ user }) => {
                secondBrainSeesMemory =
                  user.includes('项目上线前需要执行复核') &&
                  user.includes('确认最终负责人')

                const completeDecision = buildCompleteTaskDecision({
                  summary: 'memory 已成功跨轮保持。',
                  todolist: [
                    {
                      item: '确认最终负责人',
                      status: 'done'
                    },
                    {
                      item: '检查是否已经满足用户诉求并能进入最终交付',
                      status: 'done'
                    }
                  ],
                  progressionSummary:
                    '已确认 thought memory 会在第二轮继续可见，且负责人事项已完成。证据是第二轮真实 brain prompt 中再次读到了第一轮写入的 todolist 和 progressionSummary。'
                })

                return {
                  thought: completeDecision.thought,
                  nextAction: completeDecision.nextAction
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
        runtime.assertThat(
          result.output.status === 'completed' && result.secondBrainSeesMemory,
          {
            name: 'stable-memory-patch-persists-across-real-graph-rounds',
            message: 'thought 写入的任务推进记忆应在下一轮真实 brain prompt 中继续存在。',
            data: {
              secondBrainSeesMemory: result.secondBrainSeesMemory
            }
          }
        )
      }
    })
  }, 15_000)
})
