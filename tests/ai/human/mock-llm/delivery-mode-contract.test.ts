import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import {
  buildCompleteTaskDecision,
  buildLearnSkillsDecision,
  buildToolDecision
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
})
