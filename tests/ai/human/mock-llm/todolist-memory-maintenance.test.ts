import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import { buildCompleteTaskDecision } from '../testUtils'

describe('ai human mock-llm backend', () => {
  it('todolist-memory-maintenance', async () => {
    await runBackendCase({
      caseId: 'todolist-memory-maintenance',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description: '验证 todolist 作为长期任务板会在真实 graph 中跨轮维护 todo、done 与 obsolete 状态。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        let secondBrainSeesTodolist = false
        const runner = createHumanTestRunner(runtime, {
          structuredOutputScript: {
            'human.brain': [
              {
                output: {
                  thought: {
                    next: '先学习一个 skill，让 todolist 进入下一轮 prompt。',
                    todolist: [
                      {
                        item: '确认 A 事项',
                        status: 'todo'
                      },
                      {
                        item: '确认 B 事项',
                        status: 'todo'
                      },
                      {
                        item: '检查是否已经满足用户诉求并能进入最终交付',
                        status: 'todo'
                      }
                    ],
                    progressionSummary: '已开始整理当前任务板。当前还没有最终证据，只先建立任务板。'
                  },
                  nextAction: {
                    action: 'learning',
                    wantLearnSkillIds: ['docx-read']
                  }
                }
              },
              ({ user }) => {
                secondBrainSeesTodolist =
                  user.includes('[todo] 确认 A 事项') &&
                  user.includes('[todo] 确认 B 事项')

                const completeDecision = buildCompleteTaskDecision({
                  summary: 'todolist 已成功跨轮维护。',
                  todolist: [
                    {
                      item: '确认 A 事项',
                      status: 'done'
                    },
                    {
                      item: '跟进 C 事项',
                      status: 'done'
                    },
                    {
                      item: '确认 B 事项',
                      status: 'obsolete'
                    },
                    {
                      item: '检查是否已经满足用户诉求并能进入最终交付',
                      status: 'done'
                    }
                  ],
                  progressionSummary:
                    '已确认 todolist 会作为长期任务板跨轮保留，并允许在新信息下重写为最新版本。证据是第二轮真实 brain prompt 中再次读到了第一轮 todolist 的 todo 项；当前没有失败事项。'
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
                  summary: 'todolist 已成功跨轮维护。',
                  deliveryMarkdown:
                    '# Todolist Memory\n\n已验证 todolist 会在下一轮真实 prompt 中继续出现，并被重写成新的任务板。'
                }
              }
            ]
          }
        })

        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: '请维护一个会跨轮保留的 todolist。'
        })

        return {
          output,
          secondBrainSeesTodolist
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.output.status === 'completed' && result.secondBrainSeesTodolist,
          {
            name: 'thought-todolist-persists-and-is-rewritten-across-real-graph-rounds',
            message:
              'todolist 应作为长期任务板在下一轮真实 brain prompt 中继续存在，并允许被重写为新的 todo/done/obsolete 版本。',
            data: {
              secondBrainSeesTodolist: result.secondBrainSeesTodolist
            }
          }
        )
      }
    })
  }, 15_000)
})
