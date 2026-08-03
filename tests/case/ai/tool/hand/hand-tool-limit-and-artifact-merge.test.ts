import path from 'node:path'
import { describe, it } from 'vitest'
import { createHandNode } from '../../../../../src/main/services/ai/human/node/handNode'
import { ensureSkillTools } from '../../../../../src/main/services/ai/human/node/learningNode/skillLoader'
import { createHumanRuntimeCache } from '../../../../../src/main/services/ai/human/node/utils/runtimeCache'
import { createInitialHumanState } from '../../../../../src/main/services/ai/human/state/schema'
import type { AiArtifactRef } from '../../../../../src/shared/types'
import { writeTestDocxFile } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

const isWindows = process.platform === 'win32'

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
        calls: [
          {
            toolName: input.toolName,
            args: input.args
          }
        ]
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
      description:
        '验证 hand 的工具调用上限收敛，以及非 artifact 工具不会覆盖已有 execution.artifacts。',
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
              command: isWindows ? 'New-Item -ItemType File -Path first.txt' : 'touch first.txt',
              commandExplanation: '创建测试文件，用于验证 terminal 产物与后续工具结果合并。'
            }
          })
        )

        const existingArtifact: AiArtifactRef = {
          kind: 'file',
          capability: 'docx',
          path: path.join(runtime.workspaceRoot, 'artifact-merge.docx'),
          fileName: 'artifact-merge.docx',
          operation: 'updated',
          applyId: 'existing-docx-change'
        }

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
            previousArtifacts: [existingArtifact]
          }),
          trace: firstState.trace
        })

        return {
          firstState,
          secondState,
          terminalArtifacts: runtime.eventCollector
            .snapshot()
            .filter((event) => event.type === 'file_artifact')
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.firstState.execution.artifacts.length === 0 &&
            result.terminalArtifacts.length === 1 &&
            result.terminalArtifacts[0]?.runId === runtime.runId,
          {
          name: 'terminal-emits-command-scoped-artifact',
            message: 'terminal 命令完成后应立即生成属于当前 Run 的文件 artifact。',
            data: {
              executionArtifacts: result.firstState.execution.artifacts,
              terminalArtifacts: result.terminalArtifacts
            }
          }
        )

        runtime.assertThat(
          result.firstState.execution.pendingDecisionHint?.code ===
            'hand_tool_limit_near_exhausted' &&
            result.firstState.execution.pendingDecisionHint.detail.toolCallCount === 1 &&
            result.firstState.execution.pendingDecisionHint.detail.limit === 1,
          {
            name: 'tool-limit-warning-uses-configured-ratio',
            message: '达到工具预算提醒比例后应产生接近上限提示，且不阻止本轮工具执行。',
            data: result.firstState.execution.pendingDecisionHint
          }
        )

        runtime.assertThat(
          result.secondState.execution.artifacts.length === 1 &&
            result.secondState.execution.artifacts.some(
              (artifact) => artifact.kind === 'file' && artifact.applyId === 'existing-docx-change'
            ) &&
            result.secondState.execution.lastToolResults?.[0]?.toolName === 'docx_read_blocks',
          {
            name: 'runtime-artifacts-are-preserved-when-next-tool-has-no-artifact',
            message:
              '后续没有 artifact 的工具执行后，execution.artifacts 应保留已有产物而不是被覆盖。',
            data: {
              artifacts: result.secondState.execution.artifacts,
              lastToolUseResults: result.secondState.execution.lastToolResults
            }
          }
        )

        runtime.assertThat(
          result.secondState.execution.pendingDecisionHint?.code === 'hand_tool_limit_exceeded' &&
            result.secondState.execution.pendingDecisionHint.detail.limit === 1 &&
            result.secondState.execution.lastToolResults?.[0]?.toolName === 'docx_read_blocks' &&
            result.secondState.execution.deliveryGuidanceItems?.some((item) =>
              item.text.includes('工具调用预算耗尽')
            ),
          {
            name: 'tool-limit-produces-converging-decision-hint',
            message:
              '超过 hardActionLimit 后，hand 应写入强制收尾型 decisionHint、追加交付说明，并保留当前工具结果。',
            data: {
              decisionHint: result.secondState.execution.pendingDecisionHint,
              lastToolUseResults: result.secondState.execution.lastToolResults,
              deliveryGuidanceItems: result.secondState.execution.deliveryGuidanceItems
            }
          }
        )
      }
    })
  })
})
