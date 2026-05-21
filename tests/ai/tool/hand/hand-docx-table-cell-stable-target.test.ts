import { describe, it } from 'vitest'
import { createHandNode } from '../../../../src/main/services/ai/human/node/handNode'
import { ensureSkillTools } from '../../../../src/main/services/ai/human/node/learningNode/skillLoader'
import { executeToolCall } from '../../../../src/main/services/ai/human/node/handNode/toolExecutor'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'
import { createHumanRuntimeCache } from '../../../../src/main/services/ai/human/node/utils/runtimeCache'
import { createDocxToolHarness, writeTestDocxFile } from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import type { DocxOutlineResult, DocxSearchResult } from '../docx/testUtils'
import { findParagraphBlockIdByText, findTableCellBlockIdByText } from '../docx/testUtils'

describe('ai tool hand backend', () => {
  it('hand-docx-table-cell-stable-target', async () => {
    await runBackendCase({
      caseId: 'hand-docx-table-cell-stable-target',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['hand'],
      description: '验证同批 docx 串行写中，前序结构插入后仍可基于 stable locator 恢复原表格 cell 并继续写入。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(runtime.workspaceRoot, 'table-cell-stable-target.docx', [
          { type: 'paragraph', text: '开头段落' },
          { type: 'paragraph', text: '插入锚点段落' },
          {
            type: 'table',
            rows: [
              ['Topic', 'Owner'],
              ['Risk', 'Alice']
            ]
          }
        ])

        const harness = createDocxToolHarness(runtime)
        const outline = await harness.invoke<DocxOutlineResult>('docx_outline', {
          sourcePath: 'table-cell-stable-target.docx'
        })
        await harness.release()

        const anchorBlockId = findParagraphBlockIdByText(outline.blocks, '插入锚点段落')
        const ownerCellBlockId = findTableCellBlockIdByText(outline.blocks, 'Alice')

        const ctx = runtime.createAiRunContext()
        const cache = createHumanRuntimeCache()
        ensureSkillTools({ cache, ctx, runId: runtime.runId, taskId: runtime.taskId, skillId: 'docx-read' })
        ensureSkillTools({ cache, ctx, runId: runtime.runId, taskId: runtime.taskId, skillId: 'docx-write' })

        const handNode = createHandNode({ ctx, cache })
        const state = await handNode({
          ...createInitialHumanState({
            taskId: runtime.taskId,
            userInput: '请插入说明并更新负责人'
          }),
          skills: {
            learnedSkillIds: ['docx-read', 'docx-write']
          },
          execution: {
            ...createInitialHumanState({
              taskId: runtime.taskId,
              userInput: '请插入说明并更新负责人'
            }).execution,
            currentThought: {
              thought: {
                next: '先插段落再更新表格单元格'
              },
              nextAction: {
                action: 'hand',
                toolUsePlan: {
                  mode: 'serial',
                  calls: [
                    {
                      toolName: 'docx_paragraph_edit',
                      args: {
                        sourcePath: 'table-cell-stable-target.docx',
                        action: 'insert_before',
                        anchorBlockId,
                        text: '新增说明段落'
                      }
                    },
                    {
                      toolName: 'docx_table_edit',
                      args: {
                        sourcePath: 'table-cell-stable-target.docx',
                        action: 'update_cell',
                        cellBlockId: ownerCellBlockId,
                        text: 'Bob'
                      }
                    }
                  ]
                }
              }
            }
          }
        })

        const updatedOwnerSearch = await executeToolCall({
          ctx,
          cache,
          taskId: runtime.taskId,
          learnedSkillIds: ['docx-read', 'docx-write'],
          toolName: 'docx_search',
          args: {
            sourcePath: 'table-cell-stable-target.docx',
            query: 'Bob'
          }
        })

        return {
          state,
          updatedOwnerSearch
        }
      },
      assert: async (result, runtime) => {
        const search = result.updatedOwnerSearch.data as DocxSearchResult
        runtime.assertThat(
          result.state.execution.lastToolResults?.length === 2 &&
            result.state.execution.lastToolResults.every((item) => item.code === 'ok') &&
            result.state.execution.pendingDecisionHint === undefined &&
            typeof result.state.execution.lastToolResults?.[0]?.data === 'object' &&
            result.state.execution.lastToolResults?.[0]?.data !== null &&
            search.matches.some((match) => match.blockType === 'table_cell' && match.text === 'Bob'),
          {
            name: 'table-cell-stable-target-resolves-after-structure-shift',
            message: '前序插入导致 bodyIndex 漂移后，旧 cellBlockId 仍应通过 stable locator 恢复到新表格 cell，而不是误落到 table body block 或直接跳过。',
            data: {
              lastToolResults: result.state.execution.lastToolResults,
              search
            }
          }
        )
      }
    })
  })
})
