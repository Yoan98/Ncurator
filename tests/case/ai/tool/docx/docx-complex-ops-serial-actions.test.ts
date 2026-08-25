import path from 'node:path'
import { describe, it } from 'vitest'
import {
  createDocxToolHarness,
  docxParagraphNode,
  writeTestDocxFile
} from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import {
  type DocxMutationResult,
  type DocxOutlineResult,
  type DocxReadResult,
  type DocxSearchResult,
  findParagraphBlockIdByText,
  findTableCellBlockIdByText
} from './testUtils'

describe('ai tool docx backend', () => {
  it('docx-complex-ops-serial-actions', async () => {
    await runBackendCase({
      caseId: 'docx-complex-ops-serial-actions',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证 docx_edit(actions) 按顺序组合 paragraph/table/text 编辑完成复杂修改。',
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
          const sourcePath = path.join(runtime.workspaceRoot, 'complex-ops.docx')
          const outline = await harness.invoke<DocxOutlineResult>('docx_read_outline', {
            sourcePath,
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

          const serialEdit = await harness.invoke<DocxMutationResult>('docx_edit', {
            sourcePath,
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
                blocks: [docxParagraphNode('Bob')]
              },
              {
                type: 'insert_blocks',
                blockId: insertAfterAnchor,
                position: 'after',
                blocks: [docxParagraphNode('Inserted after anchor.')]
              },
              {
                type: 'insert_blocks',
                blockId: insertBeforeAnchor,
                position: 'before',
                blocks: [docxParagraphNode('Inserted before anchor.')]
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
            sourcePath,
            query: 'Inserted after anchor.'
          })
          const readAfter = await harness.invoke<DocxReadResult>('docx_read_blocks', {
            sourcePath,
            range: { type: 'block_ids', blockIds: [searchAfter.matches[0]!.blockId] }
          })
          const finalOutline = await harness.invoke<DocxOutlineResult>('docx_read_outline', {
            sourcePath,
            ranges: [{ type: 'block_index', fromBlockIndex: 0, toBlockIndex: 79 }]
          })

          return {
            serialEdit,
            searchAfter,
            readAfter,
            finalOutline
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        const changedActions = [...result.serialEdit.changedBlocks.map((block) => block.action)]

        runtime.assertThat(
          [
            'replace_text',
            'delete_block',
            'update_table_cell',
            'insert_after',
            'insert_before'
          ].every((action) =>
            changedActions.includes(
              action as
                | 'insert_after'
                | 'insert_before'
                | 'delete_block'
                | 'update_table_cell'
                | 'replace_text'
            )
          ),
          {
            name: 'complex-ops-serial-actions-covers-all-op-types',
            message: '复杂编辑 case 应覆盖当前写工具支持的底层变更动作。',
            data: {
              changedActions
            }
          }
        )

        runtime.assertThat(
          result.searchAfter.matches.length === 1 &&
            result.readAfter.blocks.length === 1 &&
            result.finalOutline.blocks.some(
              (block) =>
                block.type === 'paragraph' && block.text.includes('Inserted before anchor.')
            ) &&
            result.finalOutline.blocks.some(
              (block) => block.type === 'table_cell' && block.text.includes('Bob')
            ) &&
            result.finalOutline.blocks.some(
              (block) =>
                block.type === 'paragraph' &&
                block.text.includes('Replaced whole block in final snapshot.')
            ),
          {
            name: 'complex-ops-serial-actions-remains-consumable-after-edits',
            message: '多次对象编辑后，结果结构仍应能继续被 read/outline 消费。',
            data: {
              searchMatches: result.searchAfter.matches,
              readBlocks: result.readAfter.blocks,
              finalOutline: result.finalOutline.blocks
            }
          }
        )
      }
    })
  })
})
