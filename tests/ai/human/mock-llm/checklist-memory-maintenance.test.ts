import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import { buildCompleteTaskDecision } from '../testUtils'

describe('ai human mock-llm backend', () => {
  it('checklist-memory-maintenance', async () => {
    await runBackendCase({
      caseId: 'checklist-memory-maintenance',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description: '验证 checklist 作为长期任务板会在真实 graph 中跨轮维护 todo、done 与 obsolete 状态。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        let secondBrainSeesChecklist = false
        const runner = createHumanTestRunner(runtime, {
          structuredOutputScript: {
            'human.brain': [
              {
                output: {
                  updatedStableMemory: {
                    currentUnderstanding: '- 已开始整理当前任务板。',
                    keyEvidence: '- 当前还没有最终证据，只先建立任务板。',
                    checklist: [
                      {
                        item: '确认 A 事项',
                        status: 'todo'
                      },
                      {
                        item: '确认 B 事项',
                        status: 'todo'
                      }
                    ]
                  },
                  thought: {
                    summary: '先学习一个 skill，让 checklist 进入下一轮 prompt。'
                  },
                  nextAction: {
                    action: 'learning',
                    wantLearnSkillIds: ['docx-read']
                  }
                }
              },
              ({ user }) => {
                secondBrainSeesChecklist =
                  user.includes('[todo] 确认 A 事项') &&
                  user.includes('[todo] 确认 B 事项')

                const completeDecision = buildCompleteTaskDecision({
                  summary: 'checklist 已成功跨轮维护。'
                })

                return {
                  updatedStableMemory: {
                    currentUnderstanding:
                      '- 已确认 checklist 会作为长期任务板跨轮保留，并允许在新信息下重写为最新版本。',
                    keyEvidence:
                      '- 第二轮真实 brain prompt 中再次读到了第一轮 checklist 的 todo 项。',
                    checklist: [
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
                      }
                    ]
                  },
                  thought: completeDecision.thought,
                  nextAction: completeDecision.nextAction
                }
              }
            ],
            'human.mouth': [
              {
                output: {
                  summary: 'checklist 已成功跨轮维护。',
                  deliveryMarkdown:
                    '# Checklist Memory\n\n已验证 checklist 会在下一轮真实 prompt 中继续出现，并被重写成新的任务板。'
                }
              }
            ]
          }
        })

        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: '请维护一个会跨轮保留的 checklist。'
        })

        return {
          output,
          secondBrainSeesChecklist
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.output.status === 'completed' && result.secondBrainSeesChecklist,
          {
            name: 'stable-checklist-persists-and-is-rewritten-across-real-graph-rounds',
            message:
              'checklist 应作为长期任务板在下一轮真实 brain prompt 中继续存在，并允许被重写为新的 todo/done/obsolete 版本。',
            data: {
              secondBrainSeesChecklist: result.secondBrainSeesChecklist
            }
          }
        )
      }
    })
  }, 15_000)
})
