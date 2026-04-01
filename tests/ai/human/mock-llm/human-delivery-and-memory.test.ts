import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import {
  buildCompleteTaskDecision,
  buildLearnSkillsDecision,
  buildToolDecision,
  filterAiRunEventsByType
} from '../testUtils'

describe('ai human mock-llm backend', () => {
  it('delivery-mode-contract', async () => {
    await runBackendCase({
      caseId: 'delivery-mode-contract',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description: '验证 mock-llm 模式下真实 mouth 会按不同 deliveryMode 走完整生产交付链路。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const createRunner = () =>
          createHumanTestRunner(runtime, {
            structuredOutputScript: {
              'human.brain': [
                {
                  output: buildLearnSkillsDecision({
                    skillIds: ['workspace-cli'],
                    summary: '学习 terminal skill',
                    reason: '需要先执行一次真实只读命令。',
                    expectedOutcome: '获得 terminal tool。'
                  })
                },
                {
                  output: buildToolDecision({
                    toolName: 'terminal_run_command',
                    args: {
                      command: 'pwd'
                    },
                    summary: '执行一次真实只读命令',
                    reason: '准备进入最终交付。',
                    expectedOutcome: '拿到工作区路径。'
                  })
                },
                {
                  output: buildCompleteTaskDecision({
                    summary: '交付准备完成。',
                    reason: '已经拿到足够信息。',
                    expectedOutcome: '按不同 deliveryMode 输出。'
                  })
                }
              ],
              'human.mouth': [
                {
                  output: {
                    summary: '已生成 context note。',
                    deliveryMarkdown:
                      '# 上下文补充结果\n\n## 本轮结论\n已补充当前上下文。\n\n## 可复用证据\n- 当前工作区路径已确认。\n\n## 当前边界\n- 仅执行了只读命令。\n\n## 未决项\n无\n\n## 建议补充方向\n- 如需继续，可补充更多材料。'
                  }
                }
              ]
            }
          })

        const contextRunner = createRunner()
        const handoffRunner = createHumanTestRunner(runtime, {
          structuredOutputScript: {
            'human.brain': [
              {
                output: buildLearnSkillsDecision({
                  skillIds: ['workspace-cli'],
                  summary: '学习 terminal skill',
                  reason: '需要先执行一次真实只读命令。',
                  expectedOutcome: '获得 terminal tool。'
                })
              },
              {
                output: buildToolDecision({
                  toolName: 'terminal_run_command',
                  args: {
                    command: 'pwd'
                  },
                  summary: '执行一次真实只读命令',
                  reason: '准备进入最终交付。',
                  expectedOutcome: '拿到工作区路径。'
                })
              },
              {
                output: buildCompleteTaskDecision({
                  summary: '交付准备完成。',
                  reason: '已经拿到足够信息。',
                  expectedOutcome: '按不同 deliveryMode 输出。'
                })
              }
            ],
            'human.mouth': [
              {
                output: {
                  summary: '已生成 handoff。',
                  deliveryMarkdown:
                    '# 任务交接结果\n\n## 任务完成情况\n已完成当前子任务。\n\n## 已确认信息\n- 当前工作区路径已确认。\n\n## 关键证据\n- 通过真实 terminal 工具读取了工作区路径。\n\n## 产物与引用\n无\n\n## 未决与风险\n无\n\n## 对后续任务的影响\n后续任务可直接复用当前工作区信息。\n\n## 建议下一步\n- 如需继续，可执行下一个子任务。'
                }
              }
            ]
          }
        })

        const contextOutput = await contextRunner.run(
          {
            taskId: `${runtime.taskId}-context`,
            userInput: '请输出 context_note。'
          },
          {
            deliveryMode: 'context_note',
            internalDelivery: true
          }
        )
        const handoffOutput = await handoffRunner.run(
          {
            taskId: `${runtime.taskId}-handoff`,
            userInput: '请输出 task_handoff。'
          },
          {
            deliveryMode: 'task_handoff',
            internalDelivery: true
          }
        )

        return {
          contextOutput,
          handoffOutput,
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.contextOutput.deliveryMarkdown.includes('## 可复用证据') &&
            result.handoffOutput.deliveryMarkdown.includes('## 关键证据'),
          {
            name: 'mouth-honors-delivery-mode-contract',
            message: '真实 mouth 应按 context_note 和 task_handoff 的结构化契约输出内容。',
            data: {
              context: result.contextOutput.deliveryMarkdown,
              handoff: result.handoffOutput.deliveryMarkdown
            }
          }
        )
      }
    })
  })

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
