import { describe, it } from 'vitest'
import { createHandNode } from '../../../../src/main/services/ai/human/node/handNode'
import { ensureSkillTools } from '../../../../src/main/services/ai/human/node/learningNode/skillLoader'
import { createHumanRuntimeCache } from '../../../../src/main/services/ai/human/node/utils/runtimeCache'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'
import { writeTestDocxFile } from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import { filterEventsByType } from '../testHelpers'

type DocxOpenResult = {
  ok: boolean
  docId: string
}

const invokeCachedTool = async <TResult>(
  toolset: readonly { name?: string; invoke: (input: Record<string, unknown>) => Promise<unknown> }[],
  toolName: string,
  args: Record<string, unknown>
): Promise<TResult> => {
  const tool = toolset.find((item) => String(item.name || '') === toolName)
  if (!tool) {
    throw new Error(`tool not found in cache: ${toolName}`)
  }
  return (await tool.invoke(args)) as TResult
}

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
        ensureSkillTools({
          cache,
          ctx,
          runId: runtime.runId,
          taskId: runtime.taskId,
          skillId: 'docx-delivery'
        })

        const docxReadTools = cache.skillToolsets['docx-read'] || []
        const openResult = await invokeCachedTool<DocxOpenResult>(docxReadTools, 'docx_open', {
          sourcePath: 'parallel-safe.docx'
        })

        const handNode = createHandNode({ ctx, cache })

        const safeState = await handNode({
          ...createInitialHumanState({
            taskId: runtime.taskId,
            userInput: 'inspect docx in parallel'
          }),
          brainMemory: {
            inside: {
              facts: [],
              evidences: [],
              openQuestions: []
            },
            outside: {
              ...createInitialHumanState({
                taskId: runtime.taskId,
                userInput: 'inspect docx in parallel'
              }).brainMemory.outside,
              learnedSkillIds: ['docx-read']
            }
          },
          lastBrainDecision: {
            memoryOps: [],
            decision: {
              summary: '并行读取 docx 结构和命中段落',
              reason: '两个工具都是 read_only 且 parallelSafe。',
              expectedOutcome: '直接返回 outline 和 search 结果。'
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
                      docId: openResult.docId,
                      maxBlocks: 20
                    }
                  },
                  {
                    toolName: 'docx_search',
                    args: {
                      docId: openResult.docId,
                      query: 'approval denied',
                      mode: 'literal'
                    }
                  }
                ]
              }
            }
          }
        })

        const toolStartedBeforeUnsafe = filterEventsByType(
          runtime.eventCollector.snapshot(),
          'tool_call_started'
        ).length

        const unsafeState = await handNode({
          ...safeState,
          brainMemory: {
            ...safeState.brainMemory,
            outside: {
              ...safeState.brainMemory.outside,
              learnedSkillIds: ['docx-read', 'docx-write', 'docx-delivery']
            }
          },
          lastBrainDecision: {
            memoryOps: [],
            decision: {
              summary: '并行写入和 validate',
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
                    toolName: 'docx_apply_ops',
                    args: {
                      docId: openResult.docId,
                      ops: [
                        {
                          type: 'replace_text',
                          query: 'Risk summary',
                          replace: 'Updated risk summary'
                        }
                      ]
                    }
                  },
                  {
                    toolName: 'docx_validate',
                    args: {
                      docId: openResult.docId
                    }
                  }
                ]
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
          unsafeState,
          toolStartedBeforeUnsafe,
          toolStartedAfterUnsafe,
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.safeState.lastToolUseResults?.length === 2 &&
            result.safeState.lastToolUseResults.every((item) => item.code === 'ok') &&
            !result.safeState.watchHint,
          {
            name: 'safe-parallel-batch-executes',
            message: '只读且 parallelSafe 的工具批次应真正执行，并写回多个 tool result。',
            data: result.safeState.lastToolUseResults
          }
        )

        runtime.assertThat(
          result.unsafeState.watchHint?.code === 'hand_plan_invalid' &&
            result.unsafeState.watchHint.detail.reason === 'parallel_requires_read_only' &&
            result.toolStartedAfterUnsafe === result.toolStartedBeforeUnsafe,
          {
            name: 'unsafe-parallel-batch-stops-before-tool-execution',
            message: 'mutating/unsafe 批次应直接返回 brain 并写入 watchHint，而不是继续执行工具。',
            data: {
              watchHint: result.unsafeState.watchHint,
              preservedLastToolUseResults: result.unsafeState.lastToolUseResults,
              toolStartedBeforeUnsafe: result.toolStartedBeforeUnsafe,
              toolStartedAfterUnsafe: result.toolStartedAfterUnsafe
            }
          }
        )
      }
    })
  })
})
