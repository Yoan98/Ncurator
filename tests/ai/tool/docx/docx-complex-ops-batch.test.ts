import { describe, it } from 'vitest'
import {
  createDocxToolHarness,
  writeTestDocxFile
} from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import {
  type DocxMutationResult,
  type DocxOutlineResult,
  type DocxReadResult,
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
      description: '验证 paragraph/table/text 三类新 docx 编辑工具可组合完成复杂编辑。',
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
          const outline = await harness.invoke<DocxOutlineResult>('docx_outline', {
            sourcePath: 'complex-ops.docx',
            ranges: [{ type: 'block_index', fromBlockIndex: 0, toBlockIndex: 49 }]
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

          const batchEdit = await harness.invoke<DocxMutationResult>('docx_edit', {
            sourcePath: 'complex-ops.docx',
            actions: [
              {
                type: 'replace_text',
                query: 'Need text replacement here.',
                replace: 'Text replaced in final snapshot.'
              },
              {
                type: 'delete_blocks',
                blockIds: [deleteBlockId]
              },
              {
                type: 'update_table_cell',
                cellBlockId: ownerCellBlockId,
                text: 'Bob'
              },
              {
                type: 'insert_blocks',
                position: 'after',
                anchorBlockId: insertAfterAnchor,
                blocks: [{ type: 'paragraph', text: 'Inserted after anchor.' }]
              },
              {
                type: 'insert_blocks',
                position: 'before',
                anchorBlockId: insertBeforeAnchor,
                blocks: [{ type: 'paragraph', text: 'Inserted before anchor.' }]
              },
              {
                type: 'replace_text',
                query: 'Replace whole block content.',
                replace: 'Replaced whole block in final snapshot.',
                blockIds: [replaceBlockId]
              }
            ]
          })
          const searchAfter = await harness.invoke<DocxSearchResult>('docx_search', {
            sourcePath: 'complex-ops.docx',
            query: 'Inserted after anchor.'
          })
          const readAfter = await harness.invoke<DocxReadResult>('docx_read_blocks', {
            sourcePath: 'complex-ops.docx',
            range: { type: 'block_ids', blockIds: [searchAfter.matches[0]!.blockId] }
          })
          const finalOutline = await harness.invoke<DocxOutlineResult>('docx_outline', {
            sourcePath: 'complex-ops.docx',
            ranges: [{ type: 'block_index', fromBlockIndex: 0, toBlockIndex: 79 }]
          })

          return {
            batchEdit,
            searchAfter,
            readAfter,
            finalOutline
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        const changedActions = [
          ...result.batchEdit.changedBlocks.map((block) => block.action)
        ]

        runtime.assertThat(
          ['replace_text', 'delete_block', 'update_table_cell', 'insert_after', 'insert_before'].every(
            (action) => changedActions.includes(
              action as
                | 'insert_after'
                | 'insert_before'
                | 'delete_block'
                | 'update_table_cell'
                | 'replace_text'
            )
          ),
          {
            name: 'complex-ops-batch-covers-all-op-types',
            message: '复杂编辑 case 应覆盖当前写工具支持的底层变更动作，并产出新的修订摘要。',
            data: {
              currentRevisionRef: result.batchEdit.currentRevisionRef,
              changedActions
            }
          }
        )

        runtime.assertThat(
          result.searchAfter.matches.length === 1 &&
            result.readAfter.blocks.length === 1 &&
            result.finalOutline.blocks.some(
              (block) => block.type === 'paragraph' && block.text.includes('Inserted before anchor.')
            ) &&
            result.finalOutline.blocks.some(
              (block) => block.type === 'table_cell' && block.text.includes('Bob')
            ) &&
            result.finalOutline.blocks.some(
              (block) => block.type === 'paragraph' && block.text.includes('Replaced whole block in final snapshot.')
            ) &&
            result.batchEdit.warnings.length === 0,
          {
            name: 'complex-ops-batch-remains-consumable-after-edits',
            message: '多次对象编辑后，结果结构仍应能继续被 read/outline 消费。',
            data: {
              searchMatches: result.searchAfter.matches,
              readBlocks: result.readAfter.blocks,
              finalOutline: result.finalOutline.blocks,
              warnings: result.batchEdit.warnings
            }
          }
        )
      }
    })
  })
})
