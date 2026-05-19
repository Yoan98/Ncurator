import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import { filterAiRunEventsByType } from '../testUtils'
import { buildCompleteTaskDecision, buildToolDecision } from '../testUtils'

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
        let fourthBrainSeesObsolete = false
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
                return {
                  thought: {
                    next: '故意错误地删除旧 todo，验证系统会要求修正任务板。',
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
                        item: '检查是否已经满足用户诉求并能进入最终交付',
                        status: 'done'
                      }
                    ],
                    progressionSummary:
                      '已确认 todolist 会作为长期任务板跨轮保留，但此轮故意遗漏被放弃事项，验证系统会要求显式保留 obsolete。'
                  },
                  nextAction: {
                    action: 'mouth'
                  }
                }
              },
              ({ user }) => {
                return buildToolDecision({
                  toolName: 'terminal_run',
                  args: {
                    command: 'pwd'
                  },
                  summary: '先保留 obsolete，再执行一次真实工具，让下一轮 brain prompt 看见 obsolete。',
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
                      status: 'todo'
                    }
                  ],
                  progressionSummary:
                    '已确认 todolist 会作为长期任务板跨轮保留，并允许在新信息下重写为最新版本。证据是第二轮真实 brain prompt 中再次读到了第一轮 todolist 的 todo 项；第三轮在 decision_hint 提示后显式保留了 obsolete 项，并继续推进。'
                })
              },
              ({ user }) => {
                fourthBrainSeesObsolete = user.includes('[obsolete] 确认 B 事项')

                const completeDecision = buildCompleteTaskDecision({
                  summary: 'todolist 已成功跨轮维护并按要求保留 obsolete。',
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
                    '已确认 todolist 会作为长期任务板跨轮保留，并允许在新信息下重写为最新版本。证据是第二轮真实 brain prompt 中再次读到了第一轮 todolist 的 todo 项；第四轮真实 brain prompt 中继续看到了 obsolete 项。'
                })

                return completeDecision
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
          secondBrainSeesTodolist,
          fourthBrainSeesObsolete,
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        const decisionHints = filterAiRunEventsByType(result.events, 'decision_hint')
        runtime.assertThat(
          result.output.status === 'completed' &&
            result.secondBrainSeesTodolist &&
            result.fourthBrainSeesObsolete &&
            decisionHints.some(
              (event) =>
                event.code === 'brain_todolist_invalid_transition' &&
                Array.isArray(event.detail?.droppedTodoItems) &&
                event.detail.droppedTodoItems.includes('确认 B 事项')
            ),
          {
            name: 'thought-todolist-persists-and-is-rewritten-across-real-graph-rounds',
            message:
              'todolist 应作为长期任务板在下一轮真实 brain prompt 中继续存在，并在丢弃旧 todo 时收到真实 decision_hint 后改写为 obsolete。',
            data: {
              secondBrainSeesTodolist: result.secondBrainSeesTodolist,
              fourthBrainSeesObsolete: result.fourthBrainSeesObsolete,
              decisionHints
            }
          }
        )
      }
    })
  }, 15_000)
})
