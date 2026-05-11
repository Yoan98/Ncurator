import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import {
  buildCompleteTaskDecision,
  buildToolDecision,
  filterAiRunEventsByType
} from '../testUtils'

describe('ai human mock-llm backend', () => {
  it('tool-limit-converge', async () => {
    await runBackendCase({
      caseId: 'tool-limit-converge',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description: '验证真实 hand node 超过 hardActionLimit 后会发出收敛型 watch_hint。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const runner = createHumanTestRunner(runtime, {
          structuredOutputScript: {
            'human.brain': [
              {
                output: buildToolDecision({
                  toolName: 'terminal_run',
                  args: {
                    command: 'pwd'
                  },
                  summary: '执行第一轮只读命令',
                  reason: '准备触发第二轮工具调用。',
                  expectedOutcome: '拿到工作区路径。'
                })
              },
              {
                output: buildToolDecision({
                  toolName: 'terminal_run',
                  args: {
                    command: 'ls'
                  },
                  summary: '执行第二轮只读命令',
                  reason: '超过临时上限后应触发收敛提醒。',
                  expectedOutcome: '验证 hand watch_hint。'
                })
              },
              {
                output: buildCompleteTaskDecision({
                  summary: '已观察到收敛提醒。',
                  reason: '两次真实工具调用已经满足测试目标。',
                  expectedOutcome: '结束任务。'
                })
              }
            ],
            'human.mouth': [
              {
                output: {
                  summary: '已观察到收敛提醒。',
                  deliveryMarkdown: '# Tool Limit\n\n已验证真实 hand 节点的收敛提醒。'
                }
              }
            ]
          },
          humanRuntimeOverrides: {
            hardActionLimit: 1
          }
        })

        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: '请连续执行两次只读命令，并观察收敛提醒。'
        })

        return {
          output,
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        const watchHints = filterAiRunEventsByType(result.events, 'watch_hint')

        runtime.assertThat(
          result.output.status === 'completed' &&
            watchHints.some(
              (event) =>
                event.source === 'hand' &&
                event.code === 'hand_tool_limit_exceeded' &&
                event.detail?.limit === 1
            ),
          {
            name: 'hand-emits-tool-limit-watchhint',
            message: '真实 hand node 超过 hardActionLimit 后应写出收敛型 watch_hint。',
            data: watchHints
          }
        )
      }
    })
  }, 15_000)
})
