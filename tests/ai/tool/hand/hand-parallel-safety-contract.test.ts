import { describe, it } from 'vitest'
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
            currentDecision: {
              decision: {
                summary: '并行读取 docx 结构和命中段落',
                reason: '两个工具都是 read_only 且 parallelSafe。',
                expectedOutcome: '直接返回 outline 和读取结果。'
              },
              readyToDeliver: false,
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
                      toolName: 'docx_read',
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
            currentDecision: {
              decision: {
                summary: '执行 6 个只读并行调用',
                reason: '验证新的并行上限允许 6 个安全调用。',
                expectedOutcome: '六个 read_only 且 parallelSafe 的调用全部真正执行。'
              },
              readyToDeliver: false,
              nextAction: {
                action: 'hand',
                toolUsePlan: {
                  mode: 'parallel',
                  calls: [
                    { toolName: 'docx_outline', args: { sourcePath, maxBlocks: 20 } },
                    { toolName: 'docx_read', args: { sourcePath, query: 'Safety' } },
                    { toolName: 'docx_read', args: { sourcePath, query: 'Risk' } },
                    { toolName: 'docx_read', args: { sourcePath, query: 'monitor' } },
                    { toolName: 'docx_read', args: { sourcePath, query: 'approval' } },
                    { toolName: 'docx_read', args: { sourcePath, query: 'edge' } }
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
            currentDecision: {
              decision: {
                summary: '执行 7 个只读并行调用',
                reason: '验证超过并行上限时会直接回到 brain。',
                expectedOutcome: '写入 parallel_limit_exceeded watchHint，且不继续执行工具。'
              },
              readyToDeliver: false,
              nextAction: {
                action: 'hand',
                toolUsePlan: {
                  mode: 'parallel',
                  calls: [
                    { toolName: 'docx_outline', args: { sourcePath, maxBlocks: 20 } },
                    { toolName: 'docx_read', args: { sourcePath, query: 'Safety' } },
                    { toolName: 'docx_read', args: { sourcePath, query: 'Risk' } },
                    { toolName: 'docx_read', args: { sourcePath, query: 'monitor' } },
                    { toolName: 'docx_read', args: { sourcePath, query: 'approval' } },
                    { toolName: 'docx_read', args: { sourcePath, query: 'edge' } },
                    { toolName: 'docx_read', args: { sourcePath, query: 'cases' } }
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
            currentDecision: {
              decision: {
                summary: '并行写入和读取',
                reason: '故意构造不安全批次，验证 hand 是否拒绝。',
                expectedOutcome: '写入 watchHint 并返回 brain。'
              },
              readyToDeliver: false,
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
                      toolName: 'docx_read',
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

        return {
          safeState,
          safeLimitState,
          limitExceededState,
          unsafeState,
          toolStartedBeforeLimitExceeded,
          toolStartedAfterLimitExceeded,
          toolStartedBeforeUnsafe,
          toolStartedAfterUnsafe
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.safeState.execution.lastToolResults?.length === 2 &&
            result.safeState.execution.lastToolResults.every((item) => item.code === 'ok') &&
            !result.safeState.execution.watchHint,
          {
            name: 'safe-parallel-batch-executes',
            message: '只读且 parallelSafe 的工具批次应真正执行，并写回多个 tool result。',
            data: result.safeState.execution.lastToolResults
          }
        )

        runtime.assertThat(
          result.safeLimitState.execution.lastToolResults?.length === 6 &&
            result.safeLimitState.execution.lastToolResults.every((item) => item.code === 'ok') &&
            !result.safeLimitState.execution.watchHint,
          {
            name: 'six-safe-parallel-calls-are-allowed',
            message: '6 个只读且 parallelSafe 的工具调用应真正执行并写回结果。',
            data: result.safeLimitState.execution.lastToolResults
          }
        )

        runtime.assertThat(
          result.limitExceededState.execution.watchHint?.code === 'hand_plan_invalid' &&
            result.limitExceededState.execution.watchHint.detail.reason === 'parallel_limit_exceeded' &&
            result.limitExceededState.execution.watchHint.detail.limit === 6 &&
            result.toolStartedAfterLimitExceeded === result.toolStartedBeforeLimitExceeded,
          {
            name: 'seven-parallel-calls-stop-before-execution',
            message: '超过 6 个并行工具调用时应直接返回 brain 并写入 parallel_limit_exceeded。',
            data: {
              watchHint: result.limitExceededState.execution.watchHint,
              toolStartedBeforeLimitExceeded: result.toolStartedBeforeLimitExceeded,
              toolStartedAfterLimitExceeded: result.toolStartedAfterLimitExceeded
            }
          }
        )

        runtime.assertThat(
          result.unsafeState.execution.watchHint?.code === 'hand_plan_invalid' &&
            result.unsafeState.execution.watchHint.detail.reason === 'parallel_requires_read_only' &&
            result.toolStartedAfterUnsafe === result.toolStartedBeforeUnsafe,
          {
            name: 'unsafe-parallel-batch-stops-before-tool-execution',
            message: 'mutating/unsafe 批次应直接返回 brain 并写入 watchHint，而不是继续执行工具。',
            data: {
              watchHint: result.unsafeState.execution.watchHint,
              preservedLastToolUseResults: result.unsafeState.execution.lastToolResults,
              toolStartedBeforeUnsafe: result.toolStartedBeforeUnsafe,
              toolStartedAfterUnsafe: result.toolStartedAfterUnsafe
            }
          }
        )
      }
    })
  })
})
