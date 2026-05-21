import { describe, it } from 'vitest'
import {
  createDocxToolHarness,
  writeRichTestDocxFile
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
  it('docx-mixed-format-preservation', async () => {
    await runBackendCase({
      caseId: 'docx-mixed-format-preservation',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证 mixed-format 文本在样式编辑后仍保持可读，且未命中段落内容不受影响。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeRichTestDocxFile(runtime.workspaceRoot, 'mixed-format.docx', [
          {
            type: 'paragraph',
            paragraph: {
              runs: [
                { text: 'Bold ', bold: true },
                { text: 'Italic ', italic: true },
                { text: 'Underline ', underline: true },
                { text: 'Green', color: '00AA00' }
              ]
            }
          },
          {
            type: 'paragraph',
            paragraph: {
              runs: [{ text: 'Change this sentence.' }]
            }
          },
          {
            type: 'table',
            rows: [
              [
                {
                  paragraphs: [
                    {
                      runs: [{ text: 'Field' }]
                    }
                  ]
                },
                {
                  paragraphs: [
                    {
                      runs: [{ text: 'Value' }]
                    }
                  ]
                }
              ],
              [
                {
                  paragraphs: [
                    {
                      runs: [{ text: 'Owner' }]
                    }
                  ]
                },
                {
                  paragraphs: [
                    {
                      runs: [
                        { text: 'Owner: ' },
                        { text: 'Alice', bold: true, color: 'FF0000' }
                      ]
                    }
                  ]
                }
              ]
            ]
          }
        ])

        const harness = createDocxToolHarness(runtime)
        try {
          const outline = await harness.invoke<DocxOutlineResult>('docx_outline', {
            sourcePath: 'mixed-format.docx',
            ranges: [{ type: 'block_index', fromBlockIndex: 0, toBlockIndex: 49 }]
          })

          const mixedParagraphBlockId = findParagraphBlockIdByText(
            outline.blocks,
            'Bold Italic Underline Green'
          )
          const ownerCellBlockId = findTableCellBlockIdByText(outline.blocks, 'Owner: Alice')

          const styledCell = await harness.invoke<DocxMutationResult>('docx_text_style_edit', {
            sourcePath: outline.sourcePath,
            blockId: ownerCellBlockId,
            query: 'Alice',
            style: {
              italic: true,
              color: '008000'
            }
          })
          const renamedCell = await harness.invoke<DocxMutationResult>('docx_text_edit', {
            sourcePath: styledCell.sourcePath,
            query: 'Alice',
            replace: 'Bob',
            blockIds: [ownerCellBlockId]
          })
          const preservedParagraph = await harness.invoke<DocxReadResult>('docx_read_blocks', {
            sourcePath: renamedCell.sourcePath,
            range: { type: 'block_ids', blockIds: [mixedParagraphBlockId] }
          })
          const updatedCell = await harness.invoke<DocxReadResult>('docx_read_blocks', {
            sourcePath: renamedCell.sourcePath,
            range: { type: 'block_ids', blockIds: [ownerCellBlockId] }
          })

          return {
            styledCell,
            renamedCell,
            preservedParagraph,
            updatedCell
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.preservedParagraph.blocks[0]?.type === 'paragraph' &&
            result.preservedParagraph.blocks[0]?.text.includes('Bold Italic Underline Green') &&
            result.styledCell.changedBlocks.some((block) => block.action === 'style_text'),
          {
            name: 'unmodified-mixed-format-content-remains-readable',
            message: '未修改段落在后续样式编辑后应继续可读，且样式工具应记录 style_text 变更。',
            data: {
              preservedParagraph: result.preservedParagraph.blocks[0],
              styledCell: result.styledCell.changedBlocks
            }
          }
        )

        runtime.assertThat(
          result.updatedCell.blocks[0]?.type === 'table_cell' &&
            result.updatedCell.blocks[0]?.text.includes('Bob') &&
            result.renamedCell.changedBlocks.length === 1,
          {
            name: 'updated-target-remains-readable-after-style-and-text-edit',
            message: '单元格经过样式和文本编辑后，仍应能按 table_cell 继续读取。',
            data: {
              updatedCell: result.updatedCell.blocks[0],
              renamedCell: result.renamedCell.changedBlocks
            }
          }
        )
      }
    })
  })
})
