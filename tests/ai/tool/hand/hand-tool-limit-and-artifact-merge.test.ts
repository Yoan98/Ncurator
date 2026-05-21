import { describe, it } from 'vitest'
import { createHandNode } from '../../../../src/main/services/ai/human/node/handNode'
import { ensureSkillTools } from '../../../../src/main/services/ai/human/node/learningNode/skillLoader'
import { createHumanRuntimeCache } from '../../../../src/main/services/ai/human/node/utils/runtimeCache'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'
import type { AiArtifactRef } from '../../../../src/shared/types'
import { writeTestDocxFile } from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'

const buildHandState = (input: {
  taskId: string
  userInput: string
  learnedSkillIds: Array<'docx-read'>
  toolName: string
  args: Record<string, unknown>
  previousArtifacts?: AiArtifactRef[]
}) => ({
  ...createInitialHumanState({
    taskId: input.taskId,
    userInput: input.userInput
  }),
  skills: {
    learnedSkillIds: input.learnedSkillIds
  },
  execution: {
    ...createInitialHumanState({
      taskId: input.taskId,
      userInput: input.userInput
    }).execution,
    artifacts: input.previousArtifacts || [],
    currentThought: {
      thought: {
        next: `调用 ${input.toolName}`
      },
      nextAction: {
        action: 'hand' as const,
        toolUsePlan: {
          mode: 'serial' as const,
          calls: [
            {
              toolName: input.toolName,
              args: input.args
            }
          ]
        }
      }
    }
  }
})

describe('ai tool hand backend', () => {
  it('hand-tool-limit-and-artifact-merge', async () => {
    await runBackendCase({
      caseId: 'hand-tool-limit-and-artifact-merge',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['hand'],
      description: '验证 hand 的工具调用上限收敛，以及非 artifact 工具不会覆盖已有 execution.artifacts。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(runtime.workspaceRoot, 'artifact-merge.docx', [
          {
            type: 'heading',
            text: 'Artifact Merge',
            level: 1
          },
          {
            type: 'paragraph',
            text: 'Preview generation should be merged with terminal artifact.'
          }
        ])

        const ctx = runtime.createAiRunContext({
          humanRuntimeOverrides: {
            hardActionLimit: 1
          }
        })
        const cache = createHumanRuntimeCache()

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
          skillId: 'docx-read'
        })

        const handNode = createHandNode({ ctx, cache })
        const firstState = await handNode(
          buildHandState({
            taskId: runtime.taskId,
            userInput: 'create a terminal artifact',
            learnedSkillIds: [],
            toolName: 'terminal_run',
            args: {
              command: 'touch first.txt'
            }
          })
        )

        const secondState = await handNode({
          ...buildHandState({
            taskId: runtime.taskId,
            userInput: 'read the docx without creating artifacts',
            learnedSkillIds: ['docx-read'],
            toolName: 'docx_read_blocks',
            args: {
              sourcePath: 'artifact-merge.docx',
            range: { type: 'block_ids', blockIds: ['b:1'] }
            },
            previousArtifacts: firstState.execution.artifacts
          }),
          trace: firstState.trace
        })

        return {
          firstState,
          secondState
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.firstState.execution.artifacts.length === 1 &&
            result.firstState.execution.artifacts[0]?.kind === 'file' &&
            result.firstState.execution.artifacts[0]?.capability === 'terminal_exec',
          {
            name: 'runtime-artifacts-grow-after-first-tool',
            message: '第一次工具执行后，execution.artifacts 应记录 terminal 产物。',
            data: result.firstState.execution.artifacts
          }
        )

        runtime.assertThat(
          result.secondState.execution.artifacts.length === 1 &&
            result.secondState.execution.artifacts.some(
              (artifact) => artifact.kind === 'file' && artifact.capability === 'terminal_exec'
            ) &&
            result.secondState.execution.lastToolResults?.[0]?.toolName === 'docx_read_blocks',
          {
            name: 'runtime-artifacts-are-preserved-when-next-tool-has-no-artifact',
            message: '后续没有 artifact 的工具执行后，execution.artifacts 应保留已有 terminal 产物而不是被覆盖。',
            data: {
              artifacts: result.secondState.execution.artifacts,
              lastToolUseResults: result.secondState.execution.lastToolResults
            }
          }
        )

        runtime.assertThat(
          result.secondState.execution.pendingDecisionHint?.code === 'hand_tool_limit_exceeded' &&
            result.secondState.execution.pendingDecisionHint.detail.limit === 1 &&
            result.secondState.execution.lastToolResults?.[0]?.toolName === 'docx_read_blocks',
          {
            name: 'tool-limit-produces-converging-decision-hint',
            message: '超过 hardActionLimit 后，hand 应写入收敛型 decisionHint，同时保留当前工具结果。',
            data: {
              decisionHint: result.secondState.execution.pendingDecisionHint,
              lastToolUseResults: result.secondState.execution.lastToolResults
            }
          }
        )
      }
    })
  })
})
