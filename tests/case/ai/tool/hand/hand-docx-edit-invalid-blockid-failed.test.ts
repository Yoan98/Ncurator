import { describe, it } from 'vitest'
import { createHandNode } from '../../../../../src/main/services/ai/human/node/handNode'
import { ensureSkillTools } from '../../../../../src/main/services/ai/human/node/learningNode/skillLoader'
import { createHumanRuntimeCache } from '../../../../../src/main/services/ai/human/node/utils/runtimeCache'
import { createInitialHumanState } from '../../../../../src/main/services/ai/human/state/schema'
import { writeTestDocxFile } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

describe('ai tool hand backend', () => {
  it('hand-docx-edit-invalid-blockid-failed', async () => {
    await runBackendCase({
      caseId: 'hand-docx-edit-invalid-blockid-failed',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['hand'],
      description: '验证 docx_edit 使用不存在 blockId 时失败并返回统一 hand_docx_edit_failed。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(runtime.workspaceRoot, 'invalid-blockid.docx', [
          { type: 'paragraph', text: 'Alpha' }
        ])

        const ctx = runtime.createAiRunContext()
        const cache = createHumanRuntimeCache()
        ensureSkillTools({
          cache,
          ctx,
          runId: runtime.runId,
          taskId: runtime.taskId,
          skillId: 'docx-write'
        })

        const handNode = createHandNode({ ctx, cache })
        const initialState = createInitialHumanState({
          taskId: runtime.taskId,
          userInput: '请修改文档'
        })
        const state = await handNode({
          ...initialState,
          skills: {
            learnedSkillIds: ['docx-write']
          },
          execution: {
            ...initialState.execution,
            currentThought: {
              thought: {
                next: '尝试使用不存在的 blockId 写入'
              },
              nextAction: {
                action: 'hand',
                calls: [
                  {
                    toolName: 'docx_edit',
                    args: {
                      sourcePath: 'invalid-blockid.docx',
                      actions: [
                        {
                          type: 'insert_blocks',
                          position: 'after',
                          anchorBlockId: 'blk_00000000000000000000000000000000',
                          blocks: [
                            {
                              type: 'paragraph',
                              children: [
                                { type: 'run', children: [{ type: 'text', text: 'Inserted' }] }
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  }
                ]
              }
            }
          }
        })

        return { state }
      },
      assert: async (result, runtime) => {
        const hint = result.state.execution.pendingDecisionHint
        const toolResult = result.state.execution.lastToolResults?.[0]
        runtime.assertThat(
          toolResult?.toolName === 'docx_edit' &&
            toolResult.ok === false &&
            hint?.code === 'hand_docx_edit_failed' &&
            hint.detail.toolName === 'docx_edit' &&
            hint.detail.sourcePath === 'invalid-blockid.docx' &&
            hint.detail.action === 'insert_blocks' &&
            hint.detail.error.includes('stale or unknown docx blockId'),
          {
            name: 'invalid-blockid-produces-unified-docx-edit-hint',
            message: '不存在/过期 blockId 写入应失败，并统一走 hand_docx_edit_failed。',
            data: {
              hint,
              lastToolResults: result.state.execution.lastToolResults
            }
          }
        )
      }
    })
  })
})
