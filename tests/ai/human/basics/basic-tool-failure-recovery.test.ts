import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import {
  createCapturingDeliveryOverride,
  filterAiRunEventsByType,
  summarizeHumanSteps
} from '../testUtils'

describe('ai human basics backend', () => {
  it('basic-tool-failure-recovery', async () => {
    await runBackendCase({
      caseId: 'basic-tool-failure-recovery',
      domain: 'ai',
      suite: 'human',
      groups: ['basics'],
      description: '验证工具失败后的返回写回，以及后续 brain 继续收敛的能力。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const delivery = createCapturingDeliveryOverride({
          buildMarkdown: '# Failure Recovery\n\n已完成失败后的收敛交付。'
        })
        const runner = createHumanTestRunner(runtime, {
          humanReasonOverrides: [
            {
              output: {
                action: 'load_skill',
                skillId: 'workspace-cli',
                rationale: '先学习 workspace-cli，准备调用 terminal 工具。',
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
                rationale: '先执行一次被注入为失败结果的工具调用，验证失败结果能否写回 state。',
                publicNarrative: '尝试执行 terminal 命令'
              }
            },
            {
              output: {
                action: 'complete_task',
                summary: '工具失败后已完成稳定收口。',
                rationale: '失败结果已经被记录，允许进入最终交付。',
                publicNarrative: '基于失败结果完成交付'
              }
            }
          ],
          toolExecutionOverrides: [
            {
              toolName: 'terminal_run_command',
              result: {
                ok: false,
                code: 'failed',
                data: {
                  ok: false,
                  code: 'failed',
                  error: 'mock terminal failure'
                }
              }
            }
          ],
          humanDeliveryOverride: delivery.override
        })

        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: '请在工具失败后继续收敛并完成任务。'
        })

        return {
          output,
          events: runtime.eventCollector.snapshot(),
          capturedState: delivery.getCapturedState()
        }
      },
      assert: async (result, runtime) => {
        const toolResults = filterAiRunEventsByType(result.events, 'tool_call_result')
        const brainSteps = filterAiRunEventsByType(result.events, 'human_step').filter(
          (event) => event.stage === 'human_brain'
        )
        const handSteps = filterAiRunEventsByType(result.events, 'human_step').filter(
          (event) => event.stage === 'human_hand'
        )

        runtime.assertThat(
          result.capturedState?.lastParallelCallToolResults?.[0]?.toolName === 'terminal_run_command' &&
            result.capturedState.lastParallelCallToolResults?.[0]?.code === 'failed' &&
            result.capturedState.lastParallelCallToolResults?.[0]?.data &&
            typeof result.capturedState.lastParallelCallToolResults[0].data === 'object' &&
            !Array.isArray(result.capturedState.lastParallelCallToolResults[0].data) &&
            result.capturedState.lastParallelCallToolResults[0].data.error === 'mock terminal failure',
          {
            name: 'failed-tool-result-is-written-back-to-state',
            message: '工具失败后，lastParallelCallToolResults 应保留失败结果，供下一轮 brain 继续消费。',
            data: result.capturedState?.lastParallelCallToolResults
          }
        )

        runtime.assertThat(
          toolResults[0]?.result?.toolName === 'terminal_run_command' &&
            toolResults[0]?.result?.code === 'failed' &&
            toolResults[0]?.result?.data &&
            typeof toolResults[0].result.data === 'object' &&
            !Array.isArray(toolResults[0].result.data) &&
            toolResults[0].result.data.error === 'mock terminal failure' &&
            handSteps[0]?.summary === '调用工具 terminal_run_command（失败）',
          {
            name: 'tool-result-event-carries-standardized-result-and-generic-hand-copy',
            message:
              'tool_call_result 应携带标准化 result，hand trace/human_step 文案应退化为通用成功失败描述，而不是依赖旧 summary。',
            data: {
              toolResult: toolResults[0],
              handSteps
            }
          }
        )

        runtime.assertThat(
          result.output.status === 'completed' &&
            toolResults.length === 1 &&
            brainSteps.length >= 3,
          {
            name: 'human-returns-to-brain-after-failure-and-converges',
            message: '工具失败后，human 应回到 brain 再次决策，并最终稳定完成交付。',
            data: {
              toolResults: toolResults.map((event) => ({
                toolName: event.toolName,
                error: event.error
              })),
              steps: summarizeHumanSteps(result.events)
            }
          }
        )
      }
    })
  })
})
