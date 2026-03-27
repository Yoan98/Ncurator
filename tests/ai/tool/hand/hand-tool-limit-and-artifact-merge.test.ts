import { describe, it } from 'vitest'
import { createHandNode } from '../../../../src/main/services/ai/human/node/handNode'
import { ensureSkillTools } from '../../../../src/main/services/ai/human/node/learningNode/skillLoader'
import { createHumanRuntimeCache } from '../../../../src/main/services/ai/human/node/utils/runtimeCache'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'
import type { AiArtifactRef } from '../../../../src/shared/types'
import { writeTestDocxFile } from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'

type DocxOpenResult = {
  ok: boolean
  docId: string
}

type ToolsetItem = {
  name?: string
  invoke: (input: Record<string, unknown>) => Promise<unknown>
}

const invokeCachedTool = async <TResult>(
  toolset: readonly ToolsetItem[],
  toolName: string,
  args: Record<string, unknown>
): Promise<TResult> => {
  const tool = toolset.find((item) => String(item.name || '') === toolName)
  if (!tool) {
    throw new Error(`tool not found in cache: ${toolName}`)
  }
  return (await tool.invoke(args)) as TResult
}

const buildHandState = (input: {
  taskId: string
  userInput: string
  learnedSkillIds: Array<'workspace-cli' | 'docx-read' | 'docx-delivery'>
  toolName: string
  args: Record<string, unknown>
  previousArtifacts?: AiArtifactRef[]
}) => ({
  ...createInitialHumanState({
    taskId: input.taskId,
    userInput: input.userInput
  }),
  brainMemory: {
    inside: {
      facts: [],
      evidences: [],
      openQuestions: []
    },
    outside: {
      ...createInitialHumanState({
        taskId: input.taskId,
        userInput: input.userInput
      }).brainMemory.outside,
      learnedSkillIds: input.learnedSkillIds
    }
  },
  runtimeArtifacts: input.previousArtifacts || [],
  lastBrainDecision: {
    memoryOps: [],
    decision: {
      summary: `调用 ${input.toolName}`,
      reason: '验证 hand 的工具上限与 artifact 合并行为。',
      expectedOutcome: '工具执行后更新 runtimeArtifacts。'
    },
    nextAction: {
      action: 'hand' as const,
      parallelCallToolParam: [
        {
          toolName: input.toolName,
          args: input.args
        }
      ]
    }
  }
})

describe('ai tool hand backend', () => {
  it('hand-tool-limit-and-artifact-merge', async () => {
    await runBackendCase({
      caseId: 'hand-tool-limit-and-artifact-merge',
      domain: 'ai',
      suite: 'tool',
      groups: ['hand'],
      description: '验证 hand 的工具调用上限收敛和 runtimeArtifacts 合并。',
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
          skillId: 'workspace-cli'
        })
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
          skillId: 'docx-delivery'
        })

        const docxReadTools = cache.skillToolsets['docx-read'] || []
        const openResult = await invokeCachedTool<DocxOpenResult>(docxReadTools, 'docx_open', {
          sourcePath: 'artifact-merge.docx'
        })

        const handNode = createHandNode({ ctx, cache })
        const firstState = await handNode(
          buildHandState({
            taskId: runtime.taskId,
            userInput: 'create a terminal artifact',
            learnedSkillIds: ['workspace-cli'],
            toolName: 'terminal_run_command',
            args: {
              command: 'touch first.txt',
              expectedArtifacts: [
                {
                  path: 'first.txt',
                  operation: 'created'
                }
              ]
            }
          })
        )

        const secondState = await handNode({
          ...buildHandState({
            taskId: runtime.taskId,
            userInput: 'create a docx preview artifact',
            learnedSkillIds: ['workspace-cli', 'docx-read', 'docx-delivery'],
            toolName: 'docx_render_preview',
            args: {
              docId: openResult.docId,
              format: 'html'
            },
            previousArtifacts: firstState.runtimeArtifacts
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
          result.firstState.runtimeArtifacts.length === 1 &&
            result.firstState.runtimeArtifacts[0]?.kind === 'file' &&
            result.firstState.runtimeArtifacts[0]?.capability === 'terminal_exec',
          {
            name: 'runtime-artifacts-grow-after-first-tool',
            message: '第一次工具执行后，runtimeArtifacts 应记录 terminal 产物。',
            data: result.firstState.runtimeArtifacts
          }
        )

        runtime.assertThat(
          result.secondState.runtimeArtifacts.length === 2 &&
            result.secondState.runtimeArtifacts.some(
              (artifact) => artifact.kind === 'file' && artifact.capability === 'terminal_exec'
            ) &&
            result.secondState.runtimeArtifacts.some(
              (artifact) =>
                artifact.kind === 'file' &&
                artifact.capability === 'docx' &&
                artifact.artifactRole === 'preview'
            ),
          {
            name: 'runtime-artifacts-merge-across-tools',
            message: '多个工具产生的 artifact 应在 hand 内正确合并，而不是相互覆盖。',
            data: result.secondState.runtimeArtifacts
          }
        )

        runtime.assertThat(
          result.secondState.watchHint?.includes('超过临时上限 1') === true &&
            result.secondState.lastParallelCallToolResults?.[0]?.toolName === 'docx_render_preview',
          {
            name: 'tool-limit-produces-converging-watchhint',
            message: '超过 hardActionLimit 后，hand 应写入收敛型 watchHint，同时保留当前工具结果。',
            data: {
              watchHint: result.secondState.watchHint,
              lastParallelCallToolResults: result.secondState.lastParallelCallToolResults
            }
          }
        )
      }
    })
  })
})
