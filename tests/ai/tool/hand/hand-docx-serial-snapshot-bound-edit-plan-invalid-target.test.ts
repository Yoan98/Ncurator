import { describe, it } from 'vitest'
import { createHandNode } from '../../../../src/main/services/ai/human/node/handNode'
import { ensureSkillTools } from '../../../../src/main/services/ai/human/node/learningNode/skillLoader'
import { createHumanRuntimeCache } from '../../../../src/main/services/ai/human/node/utils/runtimeCache'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'
import { writeTestDocxFile } from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import { executeToolCall } from '../../../../src/main/services/ai/human/node/handNode/toolExecutor'
import type { DocxOutlineResult } from '../docx/testUtils'

describe('ai tool hand backend', () => {
  it('hand-docx-serial-snapshot-bound-edit-plan-invalid-target', async () => {
    await runBackendCase({
      caseId: 'hand-docx-serial-snapshot-bound-edit-plan-invalid-target',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['hand'],
      description: '验证事务段中若后续目标已被前序操作删除，应明确失败并中止，不允许 silent fallback。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(runtime.workspaceRoot, 'invalid-target.docx', [
          { type: 'paragraph', text: 'Alpha' },
          { type: 'paragraph', text: 'Beta' }
        ])

        const ctx = runtime.createAiRunContext()
        const cache = createHumanRuntimeCache()

        ensureSkillTools({ cache, ctx, runId: runtime.runId, taskId: runtime.taskId, skillId: 'docx-read' })
        ensureSkillTools({ cache, ctx, runId: runtime.runId, taskId: runtime.taskId, skillId: 'docx-write' })

        const initialOutline = await executeToolCall({
          ctx,
          cache,
          taskId: runtime.taskId,
          learnedSkillIds: ['docx-read', 'docx-write'],
          toolName: 'docx_outline',
          args: {
            sourcePath: 'invalid-target.docx'
          }
        })
        const outlineData = initialOutline.data as DocxOutlineResult
        const alphaBlockId =
          outlineData.blocks.find((block) => block.type === 'paragraph' && block.preview.includes('Alpha'))?.blockId || ''

        const handNode = createHandNode({ ctx, cache })
        const state = await handNode({
          ...createInitialHumanState({
            taskId: runtime.taskId,
            userInput: '请连续删除再修改同一段'
          }),
          skills: {
            learnedSkillIds: ['docx-read', 'docx-write']
          },
          execution: {
            ...createInitialHumanState({
              taskId: runtime.taskId,
              userInput: '请连续删除再修改同一段'
            }).execution,
            currentThought: {
              thought: {
                next: '先删再改同一目标'
              },
              nextAction: {
                action: 'hand',
                toolUsePlan: {
                  mode: 'serial',
                  calls: [
                    {
                      toolName: 'docx_paragraph_edit',
                      args: {
                        sourcePath: 'invalid-target.docx',
                        action: 'delete',
                        blockId: alphaBlockId
                      }
                    },
                    {
                      toolName: 'docx_paragraph_edit',
                      args: {
                        sourcePath: 'invalid-target.docx',
                        action: 'replace_text',
                        blockId: alphaBlockId,
                        text: 'Should fail'
                      }
                    }
                  ]
                }
              }
            }
          }
        })

        return {
          state
        }
      },
      assert: async (result, runtime) => {
        const results = result.state.execution.lastToolResults || []
        const haltedHint =
          typeof results[1]?.data === 'object' &&
          results[1]?.data &&
          !Array.isArray(results[1]?.data) &&
          'decisionHint' in results[1].data
            ? (results[1].data as { decisionHint?: { code?: string } }).decisionHint
            : undefined
        runtime.assertThat(
          results.length === 2 &&
            results[0]?.code === 'ok' &&
            results[1]?.code === 'invalid_input' &&
            haltedHint?.code === 'hand_docx_batch_write_halted' &&
            result.state.execution.pendingDecisionHint?.code === 'hand_docx_batch_write_halted',
          {
            name: 'invalid-target-halts-transaction-with-decision-hint',
            message: '事务段内后续目标若已无法安全恢复，应停止后续写入并通过 halted decision hint 把现状交还 brain。',
            data: {
              lastToolResults: results,
              decisionHint: result.state.execution.pendingDecisionHint
            }
          }
        )
      }
    })
  })
})
