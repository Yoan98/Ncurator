import { describe, it } from 'vitest'
import { createHandNode } from '../../../../src/main/services/ai/human/node/handNode'
import { ensureSkillTools } from '../../../../src/main/services/ai/human/node/learningNode/skillLoader'
import { executeToolCall } from '../../../../src/main/services/ai/human/node/handNode/toolExecutor'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'
import { createHumanRuntimeCache } from '../../../../src/main/services/ai/human/node/utils/runtimeCache'
import { writeTestDocxFile } from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import type { DocxOutlineResult } from '../docx/testUtils'

describe('ai tool hand backend', () => {
  it('hand-docx-multi-file-single-write-allowed', async () => {
    await runBackendCase({
      caseId: 'hand-docx-multi-file-single-write-allowed',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['hand'],
      description: '验证一轮 hand 内对不同 sourcePath 各写一次可以通过。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(runtime.workspaceRoot, 'multi-file-a.docx', [
          { type: 'paragraph', text: 'Alpha' }
        ])
        await writeTestDocxFile(runtime.workspaceRoot, 'multi-file-b.docx', [
          { type: 'paragraph', text: 'Beta' }
        ])

        const ctx = runtime.createAiRunContext()
        const cache = createHumanRuntimeCache()
        ensureSkillTools({ cache, ctx, runId: runtime.runId, taskId: runtime.taskId, skillId: 'docx-read' })
        ensureSkillTools({ cache, ctx, runId: runtime.runId, taskId: runtime.taskId, skillId: 'docx-write' })

        const handNode = createHandNode({ ctx, cache })
        const state = await handNode({
          ...createInitialHumanState({
            taskId: runtime.taskId,
            userInput: '分别更新两个文档'
          }),
          skills: {
            learnedSkillIds: ['docx-read', 'docx-write']
          },
          execution: {
            ...createInitialHumanState({
              taskId: runtime.taskId,
              userInput: '分别更新两个文档'
            }).execution,
            currentThought: {
              thought: {
                next: '同轮对两个 docx 各写一次'
              },
              nextAction: {
                action: 'hand',
                toolUsePlan: {
                  mode: 'serial',
                  calls: [
                    {
                      toolName: 'docx_text_edit',
                      args: {
                        sourcePath: 'multi-file-a.docx',
                        query: 'Alpha',
                        replace: 'Alpha updated'
                      }
                    },
                    {
                      toolName: 'docx_text_edit',
                      args: {
                        sourcePath: 'multi-file-b.docx',
                        query: 'Beta',
                        replace: 'Beta updated'
                      }
                    }
                  ]
                }
              }
            }
          }
        })

        const outlineA = await executeToolCall({
          ctx,
          cache,
          taskId: runtime.taskId,
          learnedSkillIds: ['docx-read', 'docx-write'],
          toolName: 'docx_outline',
          args: {
            sourcePath: 'multi-file-a.docx',
            ranges: [{ type: 'block_index', fromBlockIndex: 0, toBlockIndex: 10 }]
          }
        })
        const outlineB = await executeToolCall({
          ctx,
          cache,
          taskId: runtime.taskId,
          learnedSkillIds: ['docx-read', 'docx-write'],
          toolName: 'docx_outline',
          args: {
            sourcePath: 'multi-file-b.docx',
            ranges: [{ type: 'block_index', fromBlockIndex: 0, toBlockIndex: 10 }]
          }
        })

        return {
          state,
          outlineA,
          outlineB
        }
      },
      assert: async (result, runtime) => {
        const outlineA = result.outlineA.data as DocxOutlineResult
        const outlineB = result.outlineB.data as DocxOutlineResult
        runtime.assertThat(
          result.state.execution.pendingDecisionHint === undefined &&
            result.state.execution.lastToolResults?.length === 2 &&
            result.state.execution.lastToolResults.every((item) => item.code === 'ok') &&
            outlineA.blocks.some((block) => block.type === 'paragraph' && block.text === 'Alpha updated') &&
            outlineB.blocks.some((block) => block.type === 'paragraph' && block.text === 'Beta updated'),
          {
            name: 'multi-file-single-write-plan-is-allowed',
            message:
              '不同 sourcePath 各出现一次 docx 写应允许通过，且各自推进独立 revision。',
            data: {
              lastToolResults: result.state.execution.lastToolResults,
              outlineA: outlineA.blocks,
              outlineB: outlineB.blocks
            }
          }
        )
      }
    })
  })
})
