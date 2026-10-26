import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import {
  buildCompleteTaskDecision,
  buildLoadToolsetsDecision,
  buildToolDecision,
  filterAiRunEventsByType,
  summarizeHumanSteps
} from '../testUtils'

describe('ai human mock-llm backend', () => {
  it('learning-hand-mouth-smoke', async () => {
    await runBackendCase({
      caseId: 'learning-hand-mouth-smoke',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description:
        '验证真实 human graph 在 mock-llm 模式下能稳定走通 brain -> toolset_loading -> hand -> 最终交付主链路。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const runner = createHumanTestRunner(runtime, {
          structuredOutputScript: {
            'human.brain': [
              {
                output: buildLoadToolsetsDecision({
                  toolsetNames: ['docx-read'],
                  summary: '先学习 docx-read'
                })
              },
              {
                output: buildToolDecision({
                  toolName: 'terminal_run',
                  args: {
                    command: 'pwd'
                  },
                  summary: '读取当前工作区路径'
                })
              },
              {
                output: buildCompleteTaskDecision({
                  summary: '已完成基础链路验证。',
                  deliveryMarkdown: '# Smoke Delivery\n\n已完成基础 human 主链路验证。'
                })
              }
            ]
          }
        })

        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: '请学习一个 toolset，调用一次工具，然后给出最终结果。'
        })

        return {
          output,
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        const humanSteps = filterAiRunEventsByType(result.events, 'human_step')
        const toolResults = filterAiRunEventsByType(result.events, 'tool_call_result')
        const loadingStarted = filterAiRunEventsByType(result.events, 'tool_call_started').find(
          (event) => event.toolName === 'load_toolset'
        )
        const loadingResult = toolResults.find((event) => event.toolName === 'load_toolset')
        const stageSet = new Set(humanSteps.map((event) => event.stage))

        runtime.assertThat(
          JSON.stringify(loadingStarted?.input) ===
            JSON.stringify({ toolsetNames: ['docx-read'] }) &&
            JSON.stringify(loadingResult?.result?.data) ===
              JSON.stringify({
                toolsetNames: ['docx-read'],
                loadingSuccessfulNames: ['docx-read'],
                loadingFailures: []
              }),
          {
            name: 'toolset-loading-events-use-names',
            message: '工具组加载开始与结果事件应使用 toolsetNames。',
            data: { input: loadingStarted?.input, result: loadingResult?.result }
          }
        )

        runtime.assertThat(
          result.output.status === 'completed' &&
            stageSet.has('human_brain') &&
            stageSet.has('human_toolset_loading') &&
            stageSet.has('human_hand'),
          {
            name: 'human-mainline-visits-all-three-parts',
            message: 'mock-llm smoke case 应显式走过 brain、toolset_loading、hand 三个部位。',
            data: {
              stages: Array.from(stageSet),
              steps: summarizeHumanSteps(result.events)
            }
          }
        )

        runtime.assertThat(
          toolResults.some((event) => event.toolName === 'terminal_run') &&
            result.output.deliveryMarkdown.includes('human 主链路验证'),
          {
            name: 'human-mainline-completes-with-real-tool-and-final-delivery',
            message: 'mock-llm smoke case 应完成真实工具调用，并通过 brain 交付收束为最终交付。',
            data: {
              toolResults: toolResults.map((event) => event.toolName),
              deliveryMarkdown: result.output.deliveryMarkdown
            }
          }
        )
      }
    })
  })
})
