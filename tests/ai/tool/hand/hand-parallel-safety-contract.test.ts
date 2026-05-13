import { describe, it } from 'vitest'
import { HUMAN_TOOL_USE_PLAN_LIMIT } from '../../../../src/main/services/ai/human/constants'
import { createHandNode } from '../../../../src/main/services/ai/human/node/handNode'
import { ensureSkillTools } from '../../../../src/main/services/ai/human/node/learningNode/skillLoader'
import { createHumanRuntimeCache } from '../../../../src/main/services/ai/human/node/utils/runtimeCache'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'
import { writeTestDocxFile } from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import { filterEventsByType } from '../testHelpers'

describe('ai tool hand backend', () => {
  it('hand-parallel-safety-contract', async () => {
    await runBackendCase({
      caseId: 'hand-parallel-safety-contract',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['hand'],
      description: '验证 hand 对并行安全批次和不安全批次的守卫行为。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(runtime.workspaceRoot, 'parallel-safe.docx', [
          {
            type: 'heading',
            text: 'Safety Report',
            level: 1
          },
          {
            type: 'paragraph',
            text: 'Risk summary: monitor approval denied edge cases.'
          }
        ])

        const ctx = runtime.createAiRunContext()
        const cache = createHumanRuntimeCache()
        ensureSkillTools({
          cache,
          ctx,
          runId: runtime.runId,
          taskId: runtime.taskId,
          skillId: 'docx-read'
        })
        ensureSkillTools({
          cache,
          ctx,
          runId: runtime.runId,
          taskId: runtime.taskId,
          skillId: 'terminal'
        })
        ensureSkillTools({
          cache,
          ctx,
          runId: runtime.runId,
          taskId: runtime.taskId,
          skillId: 'docx-write'
        })

        const handNode = createHandNode({ ctx, cache })
        const sourcePath = 'parallel-safe.docx'

        const safeState = await handNode({
          ...createInitialHumanState({
            taskId: runtime.taskId,
            userInput: 'inspect docx in parallel'
          }),
          skills: {
            learnedSkillIds: ['docx-read']
          },
          execution: {
            ...createInitialHumanState({
              taskId: runtime.taskId,
              userInput: 'inspect docx in parallel'
            }).execution,
            currentThought: {
              thought: {
                next: '并行读取 docx 结构和命中段落'
              },
              nextAction: {
                action: 'hand',
                toolUsePlan: {
                  mode: 'parallel',
                  calls: [
                    {
                      toolName: 'docx_outline',
                      args: {
                        sourcePath,
                        maxBlocks: 20
                      }
                    },
                    {
                      toolName: 'docx_search',
                      args: {
                        sourcePath,
                        query: 'approval denied'
                      }
                    }
                  ]
                }
              }
            }
          }
        })

        const safeLimitState = await handNode({
          ...safeState,
          skills: {
            learnedSkillIds: ['docx-read']
          },
          execution: {
            ...safeState.execution,
            currentThought: {
              thought: {
                next: '执行计划长度上限内的只读并行调用'
              },
              nextAction: {
                action: 'hand',
                toolUsePlan: {
                  mode: 'parallel',
                  calls: [
                    { toolName: 'docx_outline', args: { sourcePath, maxBlocks: 20 } },
                    { toolName: 'docx_search', args: { sourcePath, query: 'Safety' } },
                    { toolName: 'docx_search', args: { sourcePath, query: 'Risk' } }
                  ]
                }
              }
            }
          }
        })

        const toolStartedBeforeLimitExceeded = filterEventsByType(
          runtime.eventCollector.snapshot(),
          'tool_call_started'
        ).length

        const limitExceededState = await handNode({
          ...safeLimitState,
          skills: {
            learnedSkillIds: ['docx-read']
          },
          execution: {
            ...safeLimitState.execution,
            currentThought: {
              thought: {
                next: '执行超过总计划长度上限的并行调用'
              },
              nextAction: {
                action: 'hand',
                toolUsePlan: {
                  mode: 'parallel',
                  calls: [
                    { toolName: 'docx_outline', args: { sourcePath, maxBlocks: 20 } },
                    { toolName: 'docx_search', args: { sourcePath, query: 'Safety' } },
                    { toolName: 'docx_search', args: { sourcePath, query: 'Risk' } },
                    { toolName: 'docx_search', args: { sourcePath, query: 'cases' } }
                  ]
                }
              }
            }
          }
        })

        const toolStartedAfterLimitExceeded = filterEventsByType(
          runtime.eventCollector.snapshot(),
          'tool_call_started'
        ).length

        const toolStartedBeforeUnsafe = filterEventsByType(
          runtime.eventCollector.snapshot(),
          'tool_call_started'
        ).length

        const unsafeState = await handNode({
          ...limitExceededState,
          skills: {
            learnedSkillIds: ['docx-read', 'docx-write']
          },
          execution: {
            ...limitExceededState.execution,
            currentThought: {
              thought: {
                next: '并行写入和读取'
              },
              nextAction: {
                action: 'hand',
                toolUsePlan: {
                  mode: 'parallel',
                  calls: [
                    {
                      toolName: 'docx_text_edit',
                      args: {
                        sourcePath,
                        query: 'Risk summary',
                        replace: 'Updated risk summary'
                      }
                    },
                    {
                      toolName: 'docx_search',
                      args: {
                        sourcePath,
                        query: 'Risk summary'
                      }
                    }
                  ]
                }
              }
            }
          }
        })

        const toolStartedAfterUnsafe = filterEventsByType(
          runtime.eventCollector.snapshot(),
          'tool_call_started'
        ).length

        const toolStartedBeforeTerminalUnsafe = filterEventsByType(
          runtime.eventCollector.snapshot(),
          'tool_call_started'
        ).length

        const terminalUnsafeState = await handNode({
          ...unsafeState,
          skills: {
            learnedSkillIds: ['docx-read']
          },
          execution: {
            ...unsafeState.execution,
            currentThought: {
              thought: {
                next: '并行执行内联解释器和 docx 读取'
              },
              nextAction: {
                action: 'hand',
                toolUsePlan: {
                  mode: 'parallel',
                  calls: [
                    {
                      toolName: 'terminal_run',
                      args: {
                        command: 'python3 -c "print(1)"'
                      }
                    },
                    {
                      toolName: 'docx_outline',
                      args: {
                        sourcePath,
                        maxBlocks: 20
                      }
                    }
                  ]
                }
              }
            }
          }
        })

        const toolStartedAfterTerminalUnsafe = filterEventsByType(
          runtime.eventCollector.snapshot(),
          'tool_call_started'
        ).length

        return {
          safeState,
          safeLimitState,
          limitExceededState,
          unsafeState,
          terminalUnsafeState,
          toolStartedBeforeLimitExceeded,
          toolStartedAfterLimitExceeded,
          toolStartedBeforeUnsafe,
          toolStartedAfterUnsafe,
          toolStartedBeforeTerminalUnsafe,
          toolStartedAfterTerminalUnsafe
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.safeState.execution.lastToolResults?.length === 2 &&
            result.safeState.execution.lastToolResults.every((item) => item.code === 'ok') &&
            !result.safeState.execution.pendingDecisionHint,
          {
            name: 'safe-parallel-batch-executes',
            message: '只读且 parallelSafe 的工具批次应真正执行，并写回多个 tool result。',
            data: result.safeState.execution.lastToolResults
          }
        )

        runtime.assertThat(
          result.safeLimitState.execution.lastToolResults?.length === HUMAN_TOOL_USE_PLAN_LIMIT &&
            result.safeLimitState.execution.lastToolResults.every((item) => item.code === 'ok') &&
            !result.safeLimitState.execution.pendingDecisionHint,
          {
            name: 'safe-parallel-calls-within-tool-use-plan-limit-are-allowed',
            message: '总计划长度上限内的只读且 parallelSafe 工具调用应真正执行并写回结果。',
            data: result.safeLimitState.execution.lastToolResults
          }
        )

        runtime.assertThat(
          result.limitExceededState.execution.pendingDecisionHint?.code === 'hand_plan_invalid' &&
            result.limitExceededState.execution.pendingDecisionHint.detail.reason ===
              'tool_use_plan_limit_exceeded' &&
            result.limitExceededState.execution.pendingDecisionHint.detail.limit === HUMAN_TOOL_USE_PLAN_LIMIT &&
            result.toolStartedAfterLimitExceeded === result.toolStartedBeforeLimitExceeded,
          {
            name: 'oversized-parallel-plan-stops-at-tool-use-plan-limit-before-execution',
            message:
              '并行计划超过总长度上限时，应先返回 tool_use_plan_limit_exceeded，而不是继续执行或进入并行细分校验。',
            data: {
              decisionHint: result.limitExceededState.execution.pendingDecisionHint,
              toolStartedBeforeLimitExceeded: result.toolStartedBeforeLimitExceeded,
              toolStartedAfterLimitExceeded: result.toolStartedAfterLimitExceeded
            }
          }
        )

        runtime.assertThat(
          result.unsafeState.execution.pendingDecisionHint?.code === 'hand_plan_invalid' &&
            result.unsafeState.execution.pendingDecisionHint.detail.reason === 'parallel_requires_read_only' &&
            result.toolStartedAfterUnsafe === result.toolStartedBeforeUnsafe,
          {
            name: 'unsafe-parallel-batch-stops-before-tool-execution',
            message: 'mutating/unsafe 批次应直接返回 brain 并写入 decisionHint，而不是继续执行工具。',
            data: {
              decisionHint: result.unsafeState.execution.pendingDecisionHint,
              preservedLastToolUseResults: result.unsafeState.execution.lastToolResults,
              toolStartedBeforeUnsafe: result.toolStartedBeforeUnsafe,
              toolStartedAfterUnsafe: result.toolStartedAfterUnsafe
            }
          }
        )

        runtime.assertThat(
          result.terminalUnsafeState.execution.pendingDecisionHint?.code === 'hand_plan_invalid' &&
            result.terminalUnsafeState.execution.pendingDecisionHint.detail.reason ===
              'parallel_requires_read_only' &&
            result.terminalUnsafeState.execution.pendingDecisionHint.detail.offendingToolNames.includes(
              'terminal_run'
            ) &&
            result.toolStartedAfterTerminalUnsafe === result.toolStartedBeforeTerminalUnsafe,
          {
            name: 'inline-interpreter-terminal-command-is-not-parallel-safe',
            message:
              '内联解释器 terminal 命令即使可执行，也不应在 parallel hand 计划中被判定为只读并行安全。',
            data: {
              decisionHint: result.terminalUnsafeState.execution.pendingDecisionHint,
              toolStartedBeforeTerminalUnsafe: result.toolStartedBeforeTerminalUnsafe,
              toolStartedAfterTerminalUnsafe: result.toolStartedAfterTerminalUnsafe
            }
          }
        )
      }
    })
  })
})
