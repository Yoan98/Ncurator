import { describe, it } from 'vitest'
import {
  createDocxToolHarness,
  writeTestDocxFile
} from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import {
  type DocxApplyOpsResult,
  type DocxOpenResult,
  type DocxOutlineResult,
  type DocxSearchResult,
  findParagraphBlockIdByText,
  findTableCellBlockIdByText
} from './testUtils'

describe('ai tool docx backend', () => {
  it('docx-complex-ops-batch', async () => {
    await runBackendCase({
      caseId: 'docx-complex-ops-batch',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证 replace/insert/delete/update_table_cell/replace_text 六类复杂操作组合。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(runtime.workspaceRoot, 'complex-ops.docx', [
          {
            type: 'heading',
            text: 'Complex Ops',
            level: 1
          },
          {
            type: 'paragraph',
            text: 'Replace whole block content.'
          },
          {
            type: 'paragraph',
            text: 'Insert before this anchor.'
          },
          {
            type: 'paragraph',
            text: 'Insert after this anchor.'
          },
          {
            type: 'table',
            rows: [
              ['Topic', 'Owner'],
              ['Risk', 'Alice']
            ]
          },
          {
            type: 'paragraph',
            text: 'Delete this paragraph.'
          },
          {
            type: 'paragraph',
            text: 'Need text replacement here.'
          }
        ])

        const harness = createDocxToolHarness(runtime)
        try {
          const opened = await harness.invoke<DocxOpenResult>('docx_open', {
            sourcePath: 'complex-ops.docx'
          })
          const outline = await harness.invoke<DocxOutlineResult>('docx_outline', {
            sourcePath: opened.sourcePath,
            maxBlocks: 50,
            includeTables: true,
            includeCells: true
          })

          const replaceBlockId = findParagraphBlockIdByText(
            outline.blocks,
            'Replace whole block content.'
          )
          const insertBeforeAnchor = findParagraphBlockIdByText(
            outline.blocks,
            'Insert before this anchor.'
          )
          const insertAfterAnchor = findParagraphBlockIdByText(
            outline.blocks,
            'Insert after this anchor.'
          )
          const deleteBlockId = findParagraphBlockIdByText(outline.blocks, 'Delete this paragraph.')
          const ownerCellBlockId = findTableCellBlockIdByText(outline.blocks, 'Alice')

          const applied = await harness.invoke<DocxApplyOpsResult>('docx_apply_ops', {
            sourcePath: opened.sourcePath,
            ops: [
              {
                type: 'replace_text',
                query: 'Need text replacement here.',
                replace: 'Text replaced in final snapshot.'
              },
              {
                type: 'delete_block',
                blockId: deleteBlockId
              },
              {
                type: 'update_table_cell',
                blockId: ownerCellBlockId,
                content: [
                  {
                    kind: 'paragraph',
                    runs: [{ text: 'Bob' }]
                  }
                ]
              },
              {
                type: 'insert_after',
                anchorBlockId: insertAfterAnchor,
                content: [
                  {
                    kind: 'paragraph',
                    runs: [{ text: 'Inserted after anchor.' }]
                  }
                ]
              },
              {
                type: 'insert_before',
                anchorBlockId: insertBeforeAnchor,
                content: [
                  {
                    kind: 'paragraph',
                    runs: [{ text: 'Inserted before anchor.' }]
                  }
                ]
              },
              {
                type: 'replace_block',
                blockId: replaceBlockId,
                content: {
                  kind: 'paragraph',
                  runs: [{ text: 'Replaced whole block in final snapshot.' }]
                }
              }
            ]
          })
          const search = await harness.invoke<DocxSearchResult>('docx_search', {
            sourcePath: applied.sourcePath,
            query: 'Inserted after anchor.',
            mode: 'literal'
          })
          const finalOutline = await harness.invoke<DocxOutlineResult>('docx_outline', {
            sourcePath: applied.sourcePath,
            maxBlocks: 80,
            includeTables: true,
            includeCells: true
          })

          return {
            applied,
            search,
            finalOutline
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        const changedActions = result.applied.changedBlocks.map((block) => block.action)

        runtime.assertThat(
          ['replace_text', 'delete_block', 'update_table_cell', 'insert_after', 'insert_before', 'replace_block'].every(
            (action) => changedActions.includes(
              action as
                | 'replace_block'
                | 'insert_after'
                | 'insert_before'
                | 'delete_block'
                | 'update_table_cell'
                | 'replace_text'
            )
          ),
          {
            name: 'complex-ops-batch-covers-all-op-types',
            message: '复杂编辑 case 应覆盖六类 op，并产出新的快照摘要。',
            data: {
              currentVersionRef: result.applied.currentVersionRef,
              changedActions
            }
          }
        )

        runtime.assertThat(
          result.search.matches.length === 1 &&
            result.finalOutline.blocks.some(
              (block) => block.type === 'paragraph' && block.text.includes('Inserted before anchor.')
            ) &&
            result.finalOutline.blocks.some(
              (block) => block.type === 'table_cell' && block.text.includes('Bob')
            ) &&
            result.applied.warnings.length === 0,
          {
            name: 'complex-ops-batch-remains-consumable-after-edits',
            message: '多操作顺序执行后，结果结构仍应能继续被 search/outline 消费。',
            data: {
              searchMatches: result.search.matches,
              finalOutline: result.finalOutline.blocks,
              warnings: result.applied.warnings
            }
          }
        )
      }
    })
  })
})
