import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import {
  buildCompleteTaskDecision,
  buildToolDecision,
  filterAiRunEventsByType
} from '../testUtils'

const isWindows = process.platform === 'win32'

describe('ai human mock-llm backend', () => {
  it('tool-limit-converge', async () => {
    await runBackendCase({
      caseId: 'tool-limit-converge',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description: '验证真实 hand node 超过 hardActionLimit 后会发出收敛型 decision_hint。',
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
                    command: isWindows ? 'Get-Location' : 'pwd'
                  },
                  summary: '执行第一轮安全指令'
                })
              },
              {
                output: buildToolDecision({
                  toolName: 'terminal_run',
                  args: {
                    command: isWindows ? 'Get-ChildItem -LiteralPath .' : 'ls'
                  },
                  summary: '执行第二轮安全指令'
                })
              },
              {
                output: buildCompleteTaskDecision({
                  summary: '已观察到收敛提醒。'
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
          userInput: '请连续执行两次安全指令，并观察收敛提醒。'
        })

        return {
          output,
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        const decisionHints = filterAiRunEventsByType(result.events, 'decision_hint')

        runtime.assertThat(
          result.output.status === 'completed' &&
            decisionHints.some(
              (event) =>
                event.source === 'hand' &&
                event.code === 'hand_tool_limit_exceeded' &&
                event.detail?.limit === 1
            ),
          {
            name: 'hand-emits-tool-limit-decision-hint',
            message: '真实 hand node 超过 hardActionLimit 后应写出收敛型 decision_hint。',
            data: decisionHints
          }
        )
      }
    })
  })
})
