import { describe, it } from 'vitest'
import { createHandNode } from '../../../../src/main/services/ai/human/node/handNode'
import { ensureSkillTools } from '../../../../src/main/services/ai/human/node/learningNode/skillLoader'
import { executeToolCall } from '../../../../src/main/services/ai/human/node/handNode/toolExecutor'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'
import { createHumanRuntimeCache } from '../../../../src/main/services/ai/human/node/utils/runtimeCache'
import { createDocxToolHarness, writeTestDocxFile } from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import type { DocxOutlineResult } from '../docx/testUtils'
import { findParagraphBlockIdByText, findTableCellBlockIdByText } from '../docx/testUtils'

describe('ai tool hand backend', () => {
  it('hand-docx-table-mixed-chain', async () => {
    await runBackendCase({
      caseId: 'hand-docx-table-mixed-chain',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['hand'],
      description:
        '验证同批 docx 串行写在混合段落与表格操作时，既能恢复旧 table cell，也不会把 insert_before 的 continuation 错续到 insert_after。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(runtime.workspaceRoot, 'table-mixed-chain.docx', [
          { type: 'paragraph', text: '一、风险综述' },
          { type: 'paragraph', text: '二、风险跟进说明' },
          {
            type: 'table',
            rows: [
              ['事项', '负责人'],
              ['供应商补件', 'Alice']
            ]
          },
          { type: 'paragraph', text: '三、结论占位' }
        ])

        const harness = createDocxToolHarness(runtime)
        const outline = await harness.invoke<DocxOutlineResult>('docx_outline', {
          sourcePath: 'table-mixed-chain.docx',
          ranges: [{ type: 'block_index', fromBlockIndex: 0, toBlockIndex: 19 }],

        })
        await harness.release()

        const anchorBlockId = findParagraphBlockIdByText(outline.blocks, '二、风险跟进说明')
        const ownerCellBlockId = findTableCellBlockIdByText(outline.blocks, 'Alice')

        const ctx = runtime.createAiRunContext()
        const cache = createHumanRuntimeCache()
        ensureSkillTools({ cache, ctx, runId: runtime.runId, taskId: runtime.taskId, skillId: 'docx-read' })
        ensureSkillTools({ cache, ctx, runId: runtime.runId, taskId: runtime.taskId, skillId: 'docx-write' })

        const handNode = createHandNode({ ctx, cache })
        const state = await handNode({
          ...createInitialHumanState({
            taskId: runtime.taskId,
            userInput: '请补全这份风险说明'
          }),
          skills: {
            learnedSkillIds: ['docx-read', 'docx-write']
          },
          execution: {
            ...createInitialHumanState({
              taskId: runtime.taskId,
              userInput: '请补全这份风险说明'
            }).execution,
            currentThought: {
              thought: {
                next: '混合写入段落与表格'
              },
              nextAction: {
                action: 'hand',
                toolUsePlan: {
                  mode: 'serial',
                  calls: [
                    {
                      toolName: 'docx_paragraph_edit',
                      args: {
                        sourcePath: 'table-mixed-chain.docx',
                        action: 'insert_before',
                        anchorBlockId,
                        paragraphs: ['补充说明：供应商附件仍待法务确认。']
                      }
                    },
                    {
                      toolName: 'docx_table_edit',
                      args: {
                        sourcePath: 'table-mixed-chain.docx',
                        action: 'update_cell',
                        cellBlockId: ownerCellBlockId,
                        text: 'Bob'
                      }
                    },
                    {
                      toolName: 'docx_paragraph_edit',
                      args: {
                        sourcePath: 'table-mixed-chain.docx',
                        action: 'insert_after',
                        anchorBlockId,
                        paragraphs: ['结论：本周先完成补件闭环，再推进外发。']
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
            sourcePath: 'table-mixed-chain.docx',
            ranges: [{ type: 'block_index', fromBlockIndex: 0, toBlockIndex: 19 }]
          }
        })

        return {
          state,
          updatedOutline
        }
      },
      assert: async (result, runtime) => {
        const outline = result.updatedOutline.data as DocxOutlineResult
        const paragraphPreviews = outline.blocks
          .filter((block) => block.type === 'paragraph')
          .map((block) => block.text)
        const supplementIndex = paragraphPreviews.indexOf('补充说明：供应商附件仍待法务确认。')
        const anchorIndex = paragraphPreviews.indexOf('二、风险跟进说明')
        const conclusionIndex = paragraphPreviews.indexOf('结论：本周先完成补件闭环，再推进外发。')

        runtime.assertThat(
          result.state.execution.lastToolResults?.length === 3 &&
            result.state.execution.lastToolResults.every((item) => item.code === 'ok') &&
            result.state.execution.pendingDecisionHint === undefined &&
            typeof result.state.execution.lastToolResults?.[0]?.data === 'object' &&
            result.state.execution.lastToolResults?.[0]?.data !== null &&
            supplementIndex !== -1 &&
            anchorIndex !== -1 &&
            conclusionIndex !== -1 &&
            supplementIndex < anchorIndex &&
            conclusionIndex > anchorIndex &&
            outline.blocks.some((block) => block.type === 'table_cell' && block.text === 'Bob'),
          {
            name: 'table-mixed-chain-preserves-direction-and-table-target',
            message:
              '混合链式写中，insert_before 与 insert_after 不能共用错误的 continuation；同时旧 table cell 仍应稳定恢复并命中更新后的 Bob。',
            data: {
              lastToolResults: result.state.execution.lastToolResults,
              outline: outline.blocks
            }
          }
        )
      }
    })
  })
})
