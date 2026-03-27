import fs from 'node:fs/promises'
import { describe, it } from 'vitest'
import {
  createDocxToolHarness,
  writeRichTestDocxFile
} from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import {
  type DocxApplyOpsResult,
  type DocxGetBlockResult,
  type DocxOpenResult,
  type DocxOutlineResult,
  type DocxPreviewResult,
  findParagraphBlockIdByText,
  findTableCellBlockIdByText
} from './testUtils'

describe('ai tool docx backend', () => {
  it('docx-mixed-format-preservation', async () => {
    await runBackendCase({
      caseId: 'docx-mixed-format-preservation',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证混合格式段落与表格单元格在编辑后仍能保留/更新 run 样式。',
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
          const opened = await harness.invoke<DocxOpenResult>('docx_open', {
            sourcePath: 'mixed-format.docx'
          })
          const outline = await harness.invoke<DocxOutlineResult>('docx_outline', {
            docId: opened.docId,
            includeTables: true,
            includeCells: true,
            maxBlocks: 50
          })

          const mixedParagraphBlockId = findParagraphBlockIdByText(
            outline.blocks,
            'Bold Italic Underline Green'
          )
          const targetParagraphBlockId = findParagraphBlockIdByText(
            outline.blocks,
            'Change this sentence.'
          )
          const ownerCellBlockId = findTableCellBlockIdByText(outline.blocks, 'Owner: Alice')

          const applied = await harness.invoke<DocxApplyOpsResult>('docx_apply_ops', {
            docId: opened.docId,
            ops: [
              {
                type: 'replace_block',
                blockId: targetParagraphBlockId,
                content: {
                  kind: 'paragraph',
                  runs: [{ text: 'Changed sentence in preview.' }]
                }
              },
              {
                type: 'update_table_cell',
                blockId: ownerCellBlockId,
                content: [
                  {
                    kind: 'paragraph',
                    runs: [
                      { text: 'Owner: ' },
                      { text: 'Bob', italic: true, color: '008000' }
                    ]
                  }
                ]
              }
            ]
          })
          const preservedParagraph = await harness.invoke<DocxGetBlockResult>('docx_get_block', {
            docId: applied.newDocId,
            blockId: mixedParagraphBlockId
          })
          const updatedCell = await harness.invoke<DocxGetBlockResult>('docx_get_block', {
            docId: applied.newDocId,
            blockId: ownerCellBlockId
          })
          const preview = await harness.invoke<DocxPreviewResult>('docx_render_preview', {
            docId: applied.newDocId,
            format: 'html'
          })

          return {
            applied,
            preservedParagraph,
            updatedCell,
            preview,
            previewExists: await fs
              .access(preview.previewPath)
              .then(() => true)
              .catch(() => false)
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.preservedParagraph.block.type === 'paragraph' &&
            result.preservedParagraph.block.runs.some((run) => run.bold) &&
            result.preservedParagraph.block.runs.some((run) => run.italic) &&
            result.preservedParagraph.block.runs.some((run) => run.underline) &&
            result.preservedParagraph.block.runs.some((run) => run.color === '00AA00'),
          {
            name: 'unmodified-mixed-format-runs-remain-intact',
            message: '未修改段落的 mixed-format runs 应在后续编辑后继续保留。',
            data: result.preservedParagraph.block
          }
        )

        runtime.assertThat(
          result.updatedCell.block.type === 'table_cell' &&
            result.updatedCell.block.paragraphs.some((paragraph) =>
              paragraph.runs.some((run) => run.text === 'Bob' && run.italic && run.color === '008000')
            ) &&
            result.previewExists,
          {
            name: 'updated-target-renders-with-expected-formatting',
            message: '修改目标应按预期保留/更新样式，并生成可回看的 preview。',
            data: {
              updatedCell: result.updatedCell.block,
              previewPath: result.preview.previewPath,
              previewExists: result.previewExists
            }
          }
        )
      }
    })
  })
})
