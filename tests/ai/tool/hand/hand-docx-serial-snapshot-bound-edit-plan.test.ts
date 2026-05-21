import { describe, it } from 'vitest'
import { createHandNode } from '../../../../src/main/services/ai/human/node/handNode'
import { ensureSkillTools } from '../../../../src/main/services/ai/human/node/learningNode/skillLoader'
import { createHumanRuntimeCache } from '../../../../src/main/services/ai/human/node/utils/runtimeCache'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'
import { createDocxToolHarness, writeTestDocxFile } from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import { executeToolCall } from '../../../../src/main/services/ai/human/node/handNode/toolExecutor'
import type { DocxOutlineResult } from '../docx/testUtils'

describe('ai tool hand backend', () => {
  it('hand-docx-serial-snapshot-bound-edit-plan', async () => {
    await runBackendCase({
      caseId: 'hand-docx-serial-snapshot-bound-edit-plan',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['hand'],
      description: '验证同文件 docx 串行结构写会绑定段起点快照，而不是让旧 blockId 随结构漂移误命中。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(runtime.workspaceRoot, 'snapshot-bound.docx', [
          { type: 'paragraph', text: 'Alpha' },
          { type: 'paragraph', text: 'Beta' },
          { type: 'paragraph', text: 'Gamma' }
        ])

        const harness = createDocxToolHarness(runtime)
        const outline = await harness.invoke<DocxOutlineResult>('docx_outline', {
          sourcePath: 'snapshot-bound.docx',
          ranges: [{ type: 'block_index', fromBlockIndex: 0, toBlockIndex: 19 }]
        })
        await harness.release()

        const alphaBlockId = outline.blocks.find((block) => block.type === 'paragraph' && block.text.includes('Alpha'))?.blockId || ''
        const betaBlockId = outline.blocks.find((block) => block.type === 'paragraph' && block.text.includes('Beta'))?.blockId || ''

        const ctx = runtime.createAiRunContext()
        const cache = createHumanRuntimeCache()

        ensureSkillTools({ cache, ctx, runId: runtime.runId, taskId: runtime.taskId, skillId: 'docx-read' })
        ensureSkillTools({ cache, ctx, runId: runtime.runId, taskId: runtime.taskId, skillId: 'docx-write' })

        const handNode = createHandNode({ ctx, cache })
        const state = await handNode({
          ...createInitialHumanState({
            taskId: runtime.taskId,
            userInput: '请按计划连续修改同一 docx'
          }),
          skills: {
            learnedSkillIds: ['docx-read', 'docx-write']
          },
          execution: {
            ...createInitialHumanState({
              taskId: runtime.taskId,
              userInput: '请按计划连续修改同一 docx'
            }).execution,
            currentThought: {
              thought: {
                next: '执行同文件结构写事务段'
              },
              nextAction: {
                action: 'hand',
                toolUsePlan: {
                  mode: 'serial',
                  calls: [
                    {
                      toolName: 'docx_paragraph_edit',
                      args: {
                        sourcePath: 'snapshot-bound.docx',
                        action: 'insert_before',
                        anchorBlockId: alphaBlockId,
                        paragraphs: ['Inserted before Alpha']
                      }
                    },
                    {
                      toolName: 'docx_text_edit',
                      args: {
                        sourcePath: 'snapshot-bound.docx',
                        query: 'Beta',
                        replace: 'Beta rewritten',
                        blockIds: [betaBlockId]
                      }
                    }
                  ]
                }
              }
            }
          }
        })

        const updatedOutline = await executeToolCall({
          ctx,
          cache,
          taskId: runtime.taskId,
          learnedSkillIds: ['docx-read', 'docx-write'],
          toolName: 'docx_outline',
          args: {
            sourcePath: 'snapshot-bound.docx',
            ranges: [{ type: 'block_index', fromBlockIndex: 0, toBlockIndex: 19 }]
          }
        })

        return {
          state,
          updatedOutline
        }
      },
      assert: async (result, runtime) => {
        const outlineData = result.updatedOutline.data as DocxOutlineResult
        const paragraphTexts = outlineData.blocks
          .filter((block) => block.type === 'paragraph')
          .map((block) => block.text)

        runtime.assertThat(
          paragraphTexts[0] === 'Inserted before Alpha' &&
            paragraphTexts[1] === 'Alpha' &&
            paragraphTexts[2] === 'Beta rewritten' &&
            paragraphTexts[3] === 'Gamma',
          {
            name: 'serial-docx-writes-stay-bound-to-base-snapshot',
            message: '后续旧 blockId 应继续命中段开始时的原始节点，而不是在前序插入后漂移误改。',
            data: {
              paragraphTexts,
              updatedOutline: result.updatedOutline,
              lastToolResults: result.state.execution.lastToolResults
            }
          }
        )
      }
    })
  })
})
