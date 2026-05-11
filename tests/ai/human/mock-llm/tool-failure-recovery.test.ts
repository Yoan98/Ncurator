import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import {
  buildCompleteTaskDecision,
  buildToolDecision,
  filterAiRunEventsByType
} from '../testUtils'

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
                    command: 'cat definitely-missing-file.txt'
                  },
                  summary: '执行一个会失败的只读命令',
                  reason: '验证真实工具失败和错误恢复链路。',
                  expectedOutcome: '拿到失败结果并继续交付限制说明。'
                })
              },
              {
                output: buildCompleteTaskDecision({
                  summary: '工具失败已被识别并吸收。',
                  reason: '失败结果已经足够支持最终说明，不需要继续重试。',
                  expectedOutcome: '输出明确限制。'
                })
              }
            ],
            'human.mouth': [
              {
                output: {
                  summary: '工具失败已被识别并吸收。',
                  deliveryMarkdown: '# Failure Recovery\n\n已确认命令失败，并在最终结果中说明限制。'
                }
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

        runtime.assertThat(
          result.output.status === 'completed' &&
            Boolean(failedResult) &&
            failedResult?.result?.ok === false &&
            failedResult.result?.code !== 'ok',
          {
            name: 'human-recovers-from-real-tool-failure',
            message: '真实工具失败后，human 仍应继续走到 mouth 并输出最终结果。',
            data: failedResult
          }
        )
      }
    })
  }, 15_000)
})
