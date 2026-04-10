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
                      '- [todo] 确认 A 事项',
                      '  - note: 第一轮先建任务板。',
                      '',
                      '- [todo] 确认 B 事项',
                      '  - note: 还未开始处理。'
                    ].join('\n')
                  },
                  decision: {
                    summary: '先学习一个 skill，让 checklist 进入下一轮 prompt。',
                    reason: '需要通过真实 graph 触发第二轮 brain。',
                    expectedOutcome: '确认 checklist 在下一轮仍然可见并可被重写维护。'
                  },
                  readyToDeliver: false,
                  nextAction: {
                    action: 'learning',
                    wantLearnSkillIds: ['workspace-cli']
                  }
                }
              },
              ({ user }) => {
                secondBrainSeesChecklist =
                  user.includes('[todo] 确认 A 事项') &&
                  user.includes('第一轮先建任务板') &&
                  user.includes('[todo] 确认 B 事项') &&
                  user.includes('还未开始处理')

                const completeDecision = buildCompleteTaskDecision({
                  summary: 'checklist 已成功跨轮维护。',
                  reason: '第二轮 prompt 读到了旧 checklist，并将其重写为包含 done、todo、obsolete 的最新任务板。',
                  expectedOutcome: '进入最终交付。'
                })

                return {
                  updatedStableMemory: {
                    currentUnderstanding:
                      '- 已确认 checklist 会作为长期任务板跨轮保留，并允许在新信息下重写为最新版本。',
                    keyEvidence:
                      '- 第二轮真实 brain prompt 中再次读到了第一轮 checklist 的 todo 项与 note。',
                    checklist: [
                      '- [done] 确认 A 事项',
                      '  - note: 第二轮已验证完成。',
                      '',
                      '- [todo] 跟进 C 事项',
                      '  - note: 第二轮新增的新任务。',
                      '',
                      '- [obsolete] 确认 B 事项',
                      '  - note: 第二轮判断这条旧路径不再优先。'
                    ].join('\n')
                  },
                  decision: completeDecision.decision,
                  readyToDeliver: completeDecision.readyToDeliver,
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
  })
})
