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
          const outline = await harness.invoke<DocxOutlineResult>('docx_outline', {
            sourcePath: 'format-variants.docx',
            maxBlocks: 40
          })

          const headingBlockId = findParagraphBlockIdByText(outline.blocks, 'Weekly Format Variants')
          const narrativeBlockId = findParagraphBlockIdByText(
            outline.blocks,
            'Narrative paragraph content.'
          )
          const ownerCellBlockId = findTableCellBlockIdByText(outline.blocks, 'Alice')

          const headingBlock = await harness.invoke<DocxReadResult>('docx_read', {
            sourcePath: outline.sourcePath,
            blockId: headingBlockId
          })
          const ownerCellBlock = await harness.invoke<DocxReadResult>('docx_read', {
            sourcePath: outline.sourcePath,
            blockId: ownerCellBlockId
          })
          const updatedParagraph = await harness.invoke<DocxMutationResult>('docx_paragraph_edit', {
            sourcePath: outline.sourcePath,
            action: 'replace_text',
            blockId: narrativeBlockId,
            text: 'Narrative paragraph updated.'
          })
          const updatedCell = await harness.invoke<DocxMutationResult>('docx_table_edit', {
            sourcePath: updatedParagraph.sourcePath,
            action: 'update_cell',
            cellBlockId: ownerCellBlockId,
            text: 'Bob'
          })
          const readUpdatedParagraph = await harness.invoke<DocxReadResult>('docx_read', {
            sourcePath: updatedCell.sourcePath,
            query: 'Narrative paragraph updated.'
          })

          return {
            outline,
            headingBlock,
            ownerCellBlock,
            updatedParagraph,
            updatedCell,
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
            result.headingBlock.matches[0]?.type === 'paragraph' &&
            result.ownerCellBlock.matches[0]?.type === 'table_cell',
          {
            name: 'format-variants-return-stable-block-types',
            message: 'heading、paragraph、table 和 table_cell 都应被稳定识别和读取。',
            data: {
              outline: result.outline.blocks,
              headingBlock: result.headingBlock.matches[0],
              ownerCellBlock: result.ownerCellBlock.matches[0]
            }
          }
        )

        runtime.assertThat(
          result.updatedParagraph.changedBlocks.length === 1 &&
            result.updatedCell.changedBlocks.length === 1 &&
            result.readUpdatedParagraph.matches.length === 1 &&
            result.updatedCell.changedBlocks.some((block) => block.action === 'update_table_cell') &&
            result.updatedCell.warnings.length === 0,
          {
            name: 'format-variants-support-updating-paragraph-and-cell',
            message: 'paragraph 与 table_cell 修改后，结构仍应有效且可继续消费。',
            data: {
              updatedParagraph: result.updatedParagraph.changedBlocks,
              updatedCell: result.updatedCell.changedBlocks,
              readUpdatedParagraph: result.readUpdatedParagraph.matches,
              warnings: result.updatedCell.warnings
            }
          }
        )
      }
    })
  })
})
