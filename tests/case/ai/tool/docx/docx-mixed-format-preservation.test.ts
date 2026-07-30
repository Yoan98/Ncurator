import fs from 'node:fs/promises'
import { describe, it } from 'vitest'
import JSZip from 'jszip'
import type { DocxApplyRecord } from '../../../../../src/shared/types'
import {
  createDocxToolHarness,
  writeRichTestDocxFile
} from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
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
                      runs: [{ text: 'Owner: ' }, { text: 'Alice', bold: true, color: 'FF0000' }]
                    }
                  ]
                }
              ]
            ]
          }
        ])

        const harness = createDocxToolHarness(runtime)
        try {
          harness.ctx.beginDocxApplyRun()
          const outline = await harness.invoke<DocxOutlineResult>('docx_read_outline', {
            sourcePath: 'mixed-format.docx',
            ranges: [{ type: 'block_index', fromBlockIndex: 0, toBlockIndex: 49 }]
          })

          const mixedParagraphBlockId = findParagraphBlockIdByText(
            outline.blocks,
            'Bold Italic Underline Green'
          )
          const ownerCellBlockId = findTableCellBlockIdByText(outline.blocks, 'Owner: Alice')
          const fieldCellBlockId = findTableCellBlockIdByText(outline.blocks, 'Field')

          const styledCell = await harness.invoke<DocxMutationResult>('docx_edit', {
            sourcePath: outline.sourcePath,
            actions: [
              {
                type: 'style',
                target: {
                  type: 'text_match',
                  query: 'Alice',
                  blockIds: [ownerCellBlockId]
                },
                patch: {
                  kind: 'run',
                  italic: true,
                  color: '008000'
                }
              },
              {
                type: 'style',
                target: {
                  type: 'text_match',
                  query: 'Field',
                  blockIds: [fieldCellBlockId]
                },
                patch: { kind: 'run', bold: true }
              }
            ]
          })
          const renamedCell = await harness.invoke<DocxMutationResult>('docx_edit', {
            sourcePath: styledCell.sourcePath,
            actions: [
              {
                type: 'replace_text',
                query: 'Alice',
                replace: 'Bob',
                blockIds: [ownerCellBlockId]
              }
            ]
          })
          const preservedParagraph = await harness.invoke<DocxReadResult>('docx_read_blocks', {
            sourcePath: renamedCell.sourcePath,
            range: { type: 'block_ids', blockIds: [mixedParagraphBlockId] }
          })
          const updatedCell = await harness.invoke<DocxReadResult>('docx_read_blocks', {
            sourcePath: renamedCell.sourcePath,
            range: { type: 'block_ids', blockIds: [ownerCellBlockId] }
          })
          const records = await harness.ctx.applyDocxRunEdits()
          const record = records[0] as DocxApplyRecord
          const zip = await JSZip.loadAsync(await fs.readFile(record.preview_diff_artifact_path))
          const diffXml = await zip.file('word/document.xml')!.async('string')

          return {
            styledCell,
            renamedCell,
            preservedParagraph,
            updatedCell,
            record,
            diffXml
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.preservedParagraph.blocks[0]?.type === 'paragraph' &&
            result.preservedParagraph.blocks[0]?.text.includes('Bold Italic Underline Green') &&
            result.styledCell.changedBlocks.some((block) => block.action === 'style'),
          {
            name: 'unmodified-mixed-format-content-remains-readable',
            message: '未修改段落在后续样式编辑后应继续可读，且样式工具应记录 style 变更。',
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

        runtime.assertThat(
          result.styledCell.postWriteReadback?.regions.some((region) =>
            region.blocks.some((block) => block.type === 'table')
          ) === true &&
            result.record.change_count === 2 &&
            result.record.insert_count === 1 &&
            result.record.delete_count === 1 &&
            result.diffXml.includes('Field') &&
            result.diffXml.includes('Alice') &&
            result.diffXml.includes('Bob') &&
            result.diffXml.includes('w:fill="FDECEC"') &&
            result.diffXml.includes('w:fill="E9F7EF"'),
          {
            name: 'existing-table-cell-diff-is-granular-and-readable',
            message: '已有表格的单元格格式与文字修改都应进入 Diff，修改后回读不得为空。',
            data: {
              postWriteReadback: result.styledCell.postWriteReadback,
              record: result.record
            }
          }
        )
      }
    })
  })
})
