import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import {
  createCapturingDeliveryOverride,
  filterAiRunEventsByType,
  summarizeHumanSteps
} from '../testUtils'

describe('ai human basics backend', () => {
  it('basic-watchhint-retry', async () => {
    await runBackendCase({
      caseId: 'basic-watchhint-retry',
      domain: 'ai',
      suite: 'human',
      groups: ['basics'],
      description: '验证 memory_reducer 与 hand 写入 watchHint 后，graph 会回到 brain 并继续收敛。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const memoryReducerDelivery = createCapturingDeliveryOverride({
          buildMarkdown: '# Memory Reducer Retry\n\n已完成 watchHint 后重试。'
        })
        const memoryReducerRunner = createHumanTestRunner(runtime, {
          humanReasonOverrides: [
            {
              output: {
                memoryOps: [
                  {
                    op: 'add',
                    field: 'facts',
                    value: {
                      id: 'fact-invalid',
                      summary: '错误地引用了不存在的 evidence。',
                      evidenceIds: ['missing-evidence']
                    }
                  }
                ],
                decision: {
                  summary: '先尝试写入非法记忆。',
                  reason: '验证 memory_reducer 发现非法记忆操作后会写入 watchHint 并要求重试。',
                  expectedOutcome: '即使本轮决策无效，graph 也应回到 brain。'
                },
                nextAction: {
                  action: 'mouth'
                }
              }
            },
            {
              output: {
                action: 'complete_task',
                summary: 'memory_reducer watchHint 后已完成重试收口。',
                rationale: '重试路径已验证完成，可以结束任务。',
                publicNarrative: 'watchHint 后重新收口'
              }
            }
          ],
          humanDeliveryOverride: memoryReducerDelivery.override
        })

        const memoryReducerOutput = await memoryReducerRunner.run({
          taskId: `${runtime.taskId}-memory-reducer`,
          userInput: '请先模拟一次 memory_reducer watchHint，再完成任务。'
        })
        const memoryReducerEvents = runtime.eventCollector.snapshot()

        const handDelivery = createCapturingDeliveryOverride({
          buildMarkdown: '# Hand Retry\n\n已完成 hand watchHint 后重试。'
        })
        const handRunner = createHumanTestRunner(runtime, {
          humanReasonOverrides: [
            {
              output: {
                action: 'load_skill',
                skillId: 'workspace-cli',
                rationale: '先学习 workspace-cli，准备 hand 工具调用。',
                publicNarrative: '先学习 workspace-cli'
              }
            },
            {
              output: {
                memoryOps: [],
                decision: {
                  summary: '先尝试一个不满足并行安全要求的批次。',
                  reason: '验证 hand 写入 watchHint 后，会回到 brain 重新决策。',
                  expectedOutcome: '不安全批次应被 hand 拦下。'
                },
                nextAction: {
                  action: 'hand',
                  parallelCallToolParam: [
                    {
                      toolName: 'terminal_run_command',
                      args: {
                        command: 'pwd'
                      }
                    },
                    {
                      toolName: 'terminal_run_command',
                      args: {
                        command: 'touch retry-after-watchhint.txt',
                        expectedArtifacts: [
                          {
                            path: 'retry-after-watchhint.txt',
                            operation: 'created'
                          }
                        ]
                      }
                    }
                  ]
                }
              }
            },
            {
              output: {
                action: 'invoke_tool',
                toolName: 'terminal_run_command',
                args: {
                  command: 'pwd'
                },
                rationale: '收到 watchHint 后重新选择安全的只读工具调用继续推进。',
                publicNarrative: '改为执行安全的只读命令'
              }
            },
            {
              output: {
                action: 'complete_task',
                summary: 'hand watchHint 后已完成重试收口。',
                rationale: '重试后的工具调用已完成，可进入最终交付。',
                publicNarrative: '整理最终交付'
              }
            }
          ],
          humanDeliveryOverride: handDelivery.override
        })

        const handOutput = await handRunner.run({
          taskId: `${runtime.taskId}-hand`,
          userInput: '请先模拟一次 hand watchHint，再安全重试并完成任务。'
        })
        const handEvents = runtime.eventCollector
          .snapshot()
          .slice(memoryReducerEvents.length)

        return {
          memoryReducerOutput,
          memoryReducerEvents,
          handOutput,
          handEvents
        }
      },
      assert: async (result, runtime) => {
        const memoryWatchHints = filterAiRunEventsByType(result.memoryReducerEvents, 'watch_hint')
          .filter((event) => event.source === 'memory_reducer')
        const memoryBrainSteps = filterAiRunEventsByType(result.memoryReducerEvents, 'human_step')
          .filter((event) => event.stage === 'human_brain')
        const handWatchHints = filterAiRunEventsByType(result.handEvents, 'watch_hint').filter(
          (event) => event.source === 'hand'
        )
        const handToolResults = filterAiRunEventsByType(result.handEvents, 'tool_call_result')

        runtime.assertThat(
          result.memoryReducerOutput.status === 'completed' &&
            memoryWatchHints.length === 1 &&
            memoryBrainSteps.length >= 2,
          {
            name: 'memory-reducer-watchhint-returns-to-brain',
            message: 'memory_reducer 写入 watchHint 后，graph 应回到 brain 并继续推进到稳定完成。',
            data: {
              watchHints: memoryWatchHints.map((event) => event.summary),
              steps: summarizeHumanSteps(result.memoryReducerEvents)
            }
          }
        )

        runtime.assertThat(
          result.handOutput.status === 'completed' &&
            handWatchHints.length === 1 &&
            handToolResults.length === 1 &&
            handToolResults[0]?.toolName === 'terminal_run_command',
          {
            name: 'hand-watchhint-retries-with-safe-follow-up',
            message: 'hand 写入 watchHint 后，应回到 brain，随后用新的安全动作继续推进并完成任务。',
            data: {
              watchHints: handWatchHints.map((event) => event.summary),
              toolResults: handToolResults.map((event) => event.toolName),
              steps: summarizeHumanSteps(result.handEvents)
            }
          }
        )
      }
    })
  })
})
