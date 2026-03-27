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
  type DocxValidateResult,
  findParagraphBlockIdByText,
  findTableCellBlockIdByText
} from './testUtils'

describe('ai tool docx backend', () => {
  it('docx-complex-ops-batch', async () => {
    await runBackendCase({
      caseId: 'docx-complex-ops-batch',
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
            docId: opened.docId,
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
            docId: opened.docId,
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
          const validated = await harness.invoke<DocxValidateResult>('docx_validate', {
            docId: applied.newDocId
          })
          const search = await harness.invoke<DocxSearchResult>('docx_search', {
            docId: applied.newDocId,
            query: 'Inserted after anchor.',
            mode: 'literal'
          })
          const finalOutline = await harness.invoke<DocxOutlineResult>('docx_outline', {
            docId: applied.newDocId,
            maxBlocks: 80,
            includeTables: true,
            includeCells: true
          })

          return {
            applied,
            validated,
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
              newDocId: result.applied.newDocId,
              changedActions
            }
          }
        )

        runtime.assertThat(
          result.validated.problems.length === 0 &&
            result.search.matches.length === 1 &&
            result.finalOutline.blocks.some(
              (block) => block.type === 'paragraph' && block.text.includes('Inserted before anchor.')
            ) &&
            result.finalOutline.blocks.some(
              (block) => block.type === 'table_cell' && block.text.includes('Bob')
            ),
          {
            name: 'complex-ops-batch-remains-consumable-after-edits',
            message: '多操作顺序执行后，结果结构仍应能继续被 search/outline/validate 消费。',
            data: {
              validationProblems: result.validated.problems,
              searchMatches: result.search.matches,
              finalOutline: result.finalOutline.blocks
            }
          }
        )
      }
    })
  })
})
