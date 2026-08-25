import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { buildCompleteTaskDecision, buildToolDecision, filterAiRunEventsByType } from '../testUtils'

const isWindows = process.platform === 'win32'

describe('ai human mock-llm backend', () => {
  it('tool-failure-recovery', async () => {
    await runBackendCase({
      caseId: 'tool-failure-recovery',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description: '验证真实工具失败后，brain 能读取失败结果并继续完成最终交付。',
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
                    command: isWindows
                      ? 'Get-Content -LiteralPath definitely-missing-file.txt'
                      : 'cat definitely-missing-file.txt'
                  },
                  summary: '执行一个会失败的安全指令'
                })
              },
              {
                output: buildCompleteTaskDecision({
                  summary: '工具失败已被识别并吸收。',
                  deliveryMarkdown: '# Failure Recovery\n\n已确认命令失败，并在最终结果中说明限制。'
                })
              }
            ]
          }
        })

        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: '请执行一次会失败的工具调用，然后继续输出结果。'
        })

        return {
          output,
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        const toolResults = filterAiRunEventsByType(result.events, 'tool_call_result')
        const failedResult = toolResults.find((event) => event.toolName === 'terminal_run')
        const terminalData = failedResult?.result?.data
        const exitCode =
          typeof terminalData === 'object' &&
          terminalData !== null &&
          !Array.isArray(terminalData) &&
          typeof terminalData.exitCode === 'number'
            ? terminalData.exitCode
            : null

        runtime.assertThat(
          result.output.status === 'completed' &&
            Boolean(failedResult) &&
            failedResult?.result?.ok === true &&
            exitCode !== null &&
            exitCode !== 0,
          {
            name: 'human-recovers-from-real-tool-failure',
            message: '终端命令非零退出后，human 仍应识别失败事实并继续完成最终交付。',
            data: failedResult
          }
        )
      }
    })
  })
})
