import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import {
  createCapturingDeliveryOverride,
  filterAiRunEventsByType,
  summarizeHumanSteps
} from '../testUtils'

describe('ai human basics backend', () => {
  it('basic-tool-limit-converge', async () => {
    await runBackendCase({
      caseId: 'basic-tool-limit-converge',
      domain: 'ai',
      suite: 'human',
      groups: ['basics'],
      description: '验证工具调用超限后，human 会收到收敛型 watchHint 并结束，而不是死循环。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const delivery = createCapturingDeliveryOverride({
          buildMarkdown: '# Tool Limit\n\n已在超限提示后完成收敛。'
        })
        const runner = createHumanTestRunner(
          runtime,
          {
            humanReasonOverrides: [
              {
                output: {
                  action: 'load_skill',
                  skillId: 'workspace-cli',
                  rationale: '先学习 workspace-cli，准备多轮 terminal 调用。',
                  publicNarrative: '先学习 workspace-cli'
                }
              },
              {
                output: {
                  action: 'invoke_tool',
                  toolName: 'terminal_run_command',
                  args: {
                    command: 'pwd'
                  },
                  rationale: '先执行第一轮工具调用。',
                  publicNarrative: '执行第一轮只读命令'
                }
              },
              {
                output: {
                  action: 'invoke_tool',
                  toolName: 'terminal_run_command',
                  args: {
                    command: 'ls'
                  },
                  rationale: '继续执行第二轮工具调用，触发 hardActionLimit 收敛提示。',
                  publicNarrative: '执行第二轮只读命令'
                }
              },
              {
                output: {
                  action: 'complete_task',
                  summary: '收到工具超限提示后已完成收敛。',
                  rationale: 'watchHint 已提示优先收敛，本轮应结束而不是继续调用工具。',
                  publicNarrative: '停止继续调用工具并完成交付'
                }
              }
            ],
            humanDeliveryOverride: delivery.override
          },
          {
            hardActionLimit: 1
          }
        )

        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: '请连续调用工具，触发超限提示后完成任务。'
        })

        return {
          output,
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        const watchHints = filterAiRunEventsByType(result.events, 'watch_hint').filter(
          (event) => event.source === 'hand'
        )
        const humanSteps = filterAiRunEventsByType(result.events, 'human_step')
        const callToolSteps = humanSteps.filter((event) => event.action === 'call_tool')
        const toolResults = filterAiRunEventsByType(result.events, 'tool_call_result')

        runtime.assertThat(
          watchHints.length === 1 &&
            watchHints[0]?.summary.includes('超过临时上限 1') === true &&
            toolResults.length === 2,
          {
            name: 'tool-limit-produces-hand-watchhint',
            message: '多轮工具调用超过 hardActionLimit 后，hand 应写入超限型 watchHint，同时保留当前工具结果。',
            data: {
              watchHints: watchHints.map((event) => event.summary),
              toolResults: toolResults.map((event) => event.toolName)
            }
          }
        )

        runtime.assertThat(
          result.output.status === 'completed' &&
            callToolSteps.length === 2 &&
            humanSteps.at(-1)?.action === 'deliver_result',
          {
            name: 'tool-limit-causes-convergence-instead-of-looping',
            message: '收到超限提示后，human 应尽快收敛到最终交付，而不是继续无限调用工具。',
            data: {
              steps: summarizeHumanSteps(result.events)
            }
          }
        )
      }
    })
  })
})
