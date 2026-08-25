import { describe, it } from 'vitest'
import path from 'node:path'
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
      description: '验证 docx_edit 使用不存在 blockId 时失败并返回错误文本。',
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
            pendingRound: {
              thought: {
                text: '尝试使用不存在的 blockId 写入'
              },
              nextAction: {
                action: 'hand',
                calls: [
                  {
                    toolCallId: 'call-0',
                    toolName: 'docx_edit',
                    args: {
                      sourcePath: path.join(runtime.workspaceRoot, 'invalid-blockid.docx'),
                      actions: [
                        {
                          type: 'insert_blocks',
                          blockId: 'blk_00000000000000000000000000000000',
                          position: 'after',
                          blocks: [{ text: 'Inserted' }]
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
        const toolResult = result.state.execution.lastToolResults?.[0]
        runtime.assertThat(
          toolResult?.toolName === 'docx_edit' &&
            toolResult.ok === false &&
            typeof toolResult.data?.error === 'string' &&
            toolResult.data.error.includes('stale or unknown docx blockId'),
          {
            name: 'invalid-blockid-produces-docx-edit-error',
            message: '不存在/过期 blockId 写入应失败，并返回包含 stale or unknown docx blockId 的错误。',
            data: {
              lastToolResults: result.state.execution.lastToolResults
            }
          }
        )
      }
    })
  })
})
