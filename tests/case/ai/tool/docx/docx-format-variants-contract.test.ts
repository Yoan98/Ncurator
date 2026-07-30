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
  it('docx-format-variants-contract', async () => {
    await runBackendCase({
      caseId: 'docx-format-variants-contract',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证 paragraph/heading/table/table_cell 的读取与修改契约。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(runtime.workspaceRoot, 'format-variants.docx', [
          {
            type: 'heading',
            text: 'Weekly Format Variants',
            level: 1
          },
          {
            type: 'paragraph',
            text: 'Narrative paragraph content.'
          },
          {
            type: 'table',
            rows: [
              ['Topic', 'Owner'],
              ['Risk', 'Alice']
            ]
          }
        ])

        const harness = createDocxToolHarness(runtime)
        try {
          const outline = await harness.invoke<DocxOutlineResult>('docx_read_outline', {
            sourcePath: 'format-variants.docx',
            ranges: [{ type: 'block_index', fromBlockIndex: 0, toBlockIndex: 39 }]
          })

          const headingBlockId = findParagraphBlockIdByText(
            outline.blocks,
            'Weekly Format Variants'
          )
          const narrativeBlockId = findParagraphBlockIdByText(
            outline.blocks,
            'Narrative paragraph content.'
          )
          const ownerCellBlockId = findTableCellBlockIdByText(outline.blocks, 'Alice')

          const headingBlock = await harness.invoke<DocxReadResult>('docx_read_blocks', {
            sourcePath: outline.sourcePath,
            range: { type: 'block_ids', blockIds: [headingBlockId] }
          })
          const ownerCellBlock = await harness.invoke<DocxReadResult>('docx_read_blocks', {
            sourcePath: outline.sourcePath,
            range: { type: 'block_ids', blockIds: [ownerCellBlockId] }
          })
          const updatedParagraph = await harness.invoke<DocxMutationResult>('docx_edit', {
            sourcePath: outline.sourcePath,
            actions: [
              {
                type: 'replace_text',
                query: 'Narrative paragraph content.',
                replace: 'Narrative paragraph updated.',
                blockIds: [narrativeBlockId]
              }
            ]
          })
          const updatedCell = await harness.invoke<DocxMutationResult>('docx_edit', {
            sourcePath: updatedParagraph.sourcePath,
            actions: [
              {
                type: 'update_table_cell',
                cellBlockId: ownerCellBlockId,
                children: [docxParagraphNode('Bob')]
              }
            ]
          })
          const searchUpdatedParagraph = await harness.invoke<DocxSearchResult>('docx_search', {
            sourcePath: updatedCell.sourcePath,
            query: 'Narrative paragraph updated.'
          })
          const readUpdatedParagraph = await harness.invoke<DocxReadResult>('docx_read_blocks', {
            sourcePath: updatedCell.sourcePath,
            range: { type: 'block_ids', blockIds: [searchUpdatedParagraph.matches[0]!.blockId] }
          })

          return {
            outline,
            headingBlock,
            ownerCellBlock,
            updatedParagraph,
            updatedCell,
            searchUpdatedParagraph,
            readUpdatedParagraph
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.outline.blocks.some((block) => block.type === 'paragraph') &&
            result.outline.blocks.some((block) => block.type === 'table') &&
            result.outline.blocks.some((block) => block.type === 'table_cell') &&
            result.headingBlock.blocks[0]?.type === 'paragraph' &&
            result.ownerCellBlock.blocks[0]?.type === 'table_cell',
          {
            name: 'format-variants-return-stable-block-types',
            message: 'heading、paragraph、table 和 table_cell 都应被稳定识别和读取。',
            data: {
              outline: result.outline.blocks,
              headingBlock: result.headingBlock.blocks[0],
              ownerCellBlock: result.ownerCellBlock.blocks[0]
            }
          }
        )

        runtime.assertThat(
          result.updatedParagraph.changedBlocks.length === 1 &&
            result.updatedCell.changedBlocks.length === 1 &&
            result.searchUpdatedParagraph.matches.length === 1 &&
            result.readUpdatedParagraph.blocks.length === 1 &&
            result.updatedCell.changedBlocks.some((block) => block.action === 'update_table_cell'),
          {
            name: 'format-variants-support-updating-paragraph-and-cell',
            message: 'paragraph 与 table_cell 修改后，结构仍应有效且可继续消费。',
            data: {
              updatedParagraph: result.updatedParagraph.changedBlocks,
              updatedCell: result.updatedCell.changedBlocks,
              searchUpdatedParagraph: result.searchUpdatedParagraph.matches,
              readUpdatedParagraph: result.readUpdatedParagraph.blocks
            }
          }
        )
      }
    })
  })
})
