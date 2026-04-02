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
      description: '验证真实 graph 中第一轮 brain 写入的 memory 会在下一轮真实 prompt 中继续可见。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        let secondBrainSeesMemory = false
        const runner = createHumanTestRunner(runtime, {
          structuredOutputScript: {
            'human.brain': [
              {
                output: {
                  memoryOps: [
                    {
                      op: 'add',
                      field: 'evidences',
                      value: {
                        id: 'evidence-risk-1',
                        toolName: 'kb_fts_search_chunks',
                        summary: '知识库显示上线前必须执行复核。',
                        sourceType: 'tool_result',
                        rawRef: 'tool_result#1'
                      }
                    },
                    {
                      op: 'add',
                      field: 'facts',
                      value: {
                        id: 'fact-risk-review-1',
                        summary: '项目上线前需要执行复核。',
                        evidenceIds: ['evidence-risk-1']
                      }
                    },
                    {
                      op: 'add',
                      field: 'openQuestions',
                      value: '还不确定最终负责人。'
                    }
                  ],
                  decision: {
                    summary: '先学习一个 skill，让 memory 进入下一轮 prompt。',
                    reason: '需要通过真实 graph 触发第二轮 brain。',
                    expectedOutcome: '确认 memory 在第二轮仍然可见。'
                  },
                  readyToDeliver: false,
                  nextAction: {
                    action: 'learning',
                    wantLearnSkillIds: ['workspace-cli']
                  }
                }
              },
              ({ user }) => {
                secondBrainSeesMemory =
                  user.includes('项目上线前需要执行复核') &&
                  user.includes('知识库显示上线前必须执行复核') &&
                  user.includes('还不确定最终负责人')

                return buildCompleteTaskDecision({
                  summary: 'memory 已成功跨轮保持。',
                  reason: '第二轮 prompt 已经读到了第一轮写入的 memory。',
                  expectedOutcome: '进入最终交付。'
                })
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
            name: 'brain-memory-persists-across-real-graph-rounds',
            message: 'memoryOps 写入的事实、证据和未决项应在下一轮真实 brain prompt 中继续存在。',
            data: {
              secondBrainSeesMemory: result.secondBrainSeesMemory
            }
          }
        )
      }
    })
  })
})
