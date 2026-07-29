import fs from 'node:fs/promises'
import JSZip from 'jszip'
import { describe, it } from 'vitest'
import type { DocxApplyRecord } from '../../../../../src/shared/types'
import { createDocxToolHarness, writeTestDocxFile } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import type { DocxMutationResult, DocxOutlineResult, DocxSearchResult } from './testUtils'
import { findParagraphBlockIdByText } from './testUtils'

const readDocumentXml = async (filePath: string): Promise<string> => {
  const zip = await JSZip.loadAsync(await fs.readFile(filePath))
  return await zip.file('word/document.xml')!.async('string')
}

const count = (value: string, needle: string): number => value.split(needle).length - 1

describe('ai tool docx net diff backend', () => {
  it('docx-diff-original-block-net-semantics', async () => {
    await runBackendCase({
      caseId: 'docx-diff-original-block-net-semantics',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证同一个原始 block 的中间版本不会重复进入最终 DOCX Diff。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(runtime.workspaceRoot, 'chain.docx', [
          { type: 'paragraph', text: '版本 A' },
          { type: 'paragraph', text: '保留段落' }
        ])
        await writeTestDocxFile(runtime.workspaceRoot, 'restored.docx', [
          { type: 'paragraph', text: '恢复 A' }
        ])
        await writeTestDocxFile(runtime.workspaceRoot, 'deleted.docx', [
          { type: 'paragraph', text: '删除 A' }
        ])
        await writeTestDocxFile(runtime.workspaceRoot, 'serial-chain.docx', [
          { type: 'paragraph', text: '串行 A' }
        ])

        const harness = createDocxToolHarness(runtime)
        try {
          harness.ctx.beginDocxApplyRun()
          await harness.invoke<DocxMutationResult>('docx_edit', {
            sourcePath: 'chain.docx',
            actions: [{ type: 'replace_text', query: '版本 A', replace: '版本 B' }]
          })
          await harness.invoke<DocxMutationResult>('docx_edit', {
            sourcePath: 'chain.docx',
            actions: [{ type: 'replace_text', query: '版本 B', replace: '版本 C' }]
          })

          await harness.invoke<DocxMutationResult>('docx_edit', {
            sourcePath: 'restored.docx',
            actions: [{ type: 'replace_text', query: '恢复 A', replace: '恢复 B' }]
          })
          await harness.invoke<DocxMutationResult>('docx_edit', {
            sourcePath: 'restored.docx',
            actions: [{ type: 'replace_text', query: '恢复 B', replace: '恢复 A' }]
          })

          await harness.invoke<DocxMutationResult>('docx_edit', {
            sourcePath: 'deleted.docx',
            actions: [{ type: 'replace_text', query: '删除 A', replace: '删除 B' }]
          })
          const deletedOutline = await harness.invoke<DocxOutlineResult>('docx_read_outline', {
            sourcePath: 'deleted.docx'
          })
          await harness.invoke<DocxMutationResult>('docx_edit', {
            sourcePath: 'deleted.docx',
            actions: [
              {
                type: 'delete_blocks',
                blockIds: [findParagraphBlockIdByText(deletedOutline.blocks, '删除 B')]
              }
            ]
          })

          const serialOutline = await harness.invoke<DocxOutlineResult>('docx_read_outline', {
            sourcePath: 'serial-chain.docx'
          })
          const serialBlockId = findParagraphBlockIdByText(serialOutline.blocks, '串行 A')
          await harness.invoke<DocxMutationResult>('docx_edit', {
            sourcePath: 'serial-chain.docx',
            actions: [
              {
                type: 'replace_block',
                blockId: serialBlockId,
                block: { type: 'paragraph', text: '串行 B keyword' }
              },
              {
                type: 'replace_text',
                blockIds: [serialBlockId],
                query: 'B keyword',
                replace: 'C'
              }
            ]
          })

          const records = await harness.ctx.applyDocxRunEdits()
          const recordByName = new Map(records.map((record) => [record.source_name, record]))
          const chainRecord = recordByName.get('chain.docx') as DocxApplyRecord
          const deletedRecord = recordByName.get('deleted.docx') as DocxApplyRecord
          const serialRecord = recordByName.get('serial-chain.docx') as DocxApplyRecord
          return {
            recordNames: records.map((record) => record.source_name).sort(),
            chainRecord,
            deletedRecord,
            serialRecord,
            chainXml: await readDocumentXml(chainRecord.preview_diff_artifact_path),
            deletedXml: await readDocumentXml(deletedRecord.preview_diff_artifact_path),
            serialXml: await readDocumentXml(serialRecord.preview_diff_artifact_path),
            restoredSourceXml: await readDocumentXml(`${runtime.workspaceRoot}/restored.docx`)
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        const chainRed = count(result.chainXml, 'w:fill="FDECEC"')
        const chainGreen = count(result.chainXml, 'w:fill="E9F7EF"')
        const deletedRed = count(result.deletedXml, 'w:fill="FDECEC"')
        runtime.assertThat(
          JSON.stringify(result.recordNames) ===
            JSON.stringify(['chain.docx', 'deleted.docx', 'serial-chain.docx']) &&
            count(result.chainXml, '版本 A') === 1 &&
            count(result.chainXml, '版本 B') === 0 &&
            count(result.chainXml, '版本 C') === 1 &&
            chainRed === 1 &&
            chainGreen === 1 &&
            result.chainRecord.change_count === 1 &&
            result.chainRecord.insert_count === 1 &&
            result.chainRecord.delete_count === 1 &&
            count(result.deletedXml, '删除 A') === 1 &&
            count(result.deletedXml, '删除 B') === 0 &&
            deletedRed === 1 &&
            result.deletedRecord.change_count === 1 &&
            result.deletedRecord.insert_count === 0 &&
            result.deletedRecord.delete_count === 1 &&
            count(result.serialXml, '串行 A') === 1 &&
            count(result.serialXml, '串行 B keyword') === 0 &&
            count(result.serialXml, '串行 C') === 1 &&
            count(result.serialXml, 'w:fill="FDECEC"') === 1 &&
            count(result.serialXml, 'w:fill="E9F7EF"') === 1 &&
            result.serialRecord.change_count === 1 &&
            result.restoredSourceXml.includes('恢复 A') &&
            !result.restoredSourceXml.includes('恢复 B'),
          {
            name: 'docx-original-block-diff-collapses-to-baseline-and-final',
            message: '原始 block 多轮修改后只应显示初始和最终版本，恢复原值不得生成修改记录。',
            data: {
              recordNames: result.recordNames,
              chainRed,
              chainGreen,
              deletedRed,
              chainRecord: result.chainRecord,
              deletedRecord: result.deletedRecord,
              serialRecord: result.serialRecord
            }
          }
        )
      }
    })
  })

  it('docx-diff-generated-block-net-semantics', async () => {
    await runBackendCase({
      caseId: 'docx-diff-generated-block-net-semantics',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证本轮新增 block 的中间稿和已删除临时 block 不进入最终 Diff。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(runtime.workspaceRoot, 'generated-final.docx', [
          { type: 'paragraph', text: '锚点' }
        ])
        await writeTestDocxFile(runtime.workspaceRoot, 'generated-removed.docx', [
          { type: 'paragraph', text: '锚点' }
        ])
        await writeTestDocxFile(runtime.workspaceRoot, 'generated-table.docx', [
          { type: 'paragraph', text: '锚点' }
        ])
        const harness = createDocxToolHarness(runtime)
        try {
          harness.ctx.beginDocxApplyRun()
          for (const sourcePath of ['generated-final.docx', 'generated-removed.docx']) {
            const outline = await harness.invoke<DocxOutlineResult>('docx_read_outline', {
              sourcePath
            })
            await harness.invoke<DocxMutationResult>('docx_edit', {
              sourcePath,
              actions: [
                {
                  type: 'insert_blocks',
                  position: 'after',
                  anchorBlockId: findParagraphBlockIdByText(outline.blocks, '锚点'),
                  blocks: [
                    {
                      type: 'paragraph',
                      text: sourcePath.includes('final') ? '新增初稿' : '临时新增'
                    }
                  ]
                }
              ]
            })
          }

          const finalSearch = await harness.invoke<DocxSearchResult>('docx_search', {
            sourcePath: 'generated-final.docx',
            query: '新增初稿'
          })
          await harness.invoke<DocxMutationResult>('docx_edit', {
            sourcePath: 'generated-final.docx',
            actions: [
              {
                type: 'replace_text',
                blockIds: [finalSearch.matches[0]!.blockId],
                query: '新增初稿',
                replace: '新增终稿'
              }
            ]
          })

          const removedSearch = await harness.invoke<DocxSearchResult>('docx_search', {
            sourcePath: 'generated-removed.docx',
            query: '临时新增'
          })
          await harness.invoke<DocxMutationResult>('docx_edit', {
            sourcePath: 'generated-removed.docx',
            actions: [
              {
                type: 'delete_blocks',
                blockIds: [removedSearch.matches[0]!.blockId]
              }
            ]
          })

          const tableOutline = await harness.invoke<DocxOutlineResult>('docx_read_outline', {
            sourcePath: 'generated-table.docx'
          })
          await harness.invoke<DocxMutationResult>('docx_edit', {
            sourcePath: 'generated-table.docx',
            actions: [
              {
                type: 'insert_blocks',
                position: 'after',
                anchorBlockId: findParagraphBlockIdByText(tableOutline.blocks, '锚点'),
                blocks: [{ type: 'table', rows: [['单元格初稿', '保留值']] }]
              }
            ]
          })
          const tableCellSearch = await harness.invoke<DocxSearchResult>('docx_search', {
            sourcePath: 'generated-table.docx',
            query: '单元格初稿'
          })
          await harness.invoke<DocxMutationResult>('docx_edit', {
            sourcePath: 'generated-table.docx',
            actions: [
              {
                type: 'update_table_cell',
                cellBlockId: tableCellSearch.matches.find((match) => match.type === 'table_cell')!
                  .blockId,
                text: '单元格终稿'
              }
            ]
          })

          const records = await harness.ctx.applyDocxRunEdits()
          const recordByName = new Map(records.map((item) => [item.source_name, item]))
          const record = recordByName.get('generated-final.docx') as DocxApplyRecord
          const tableRecord = recordByName.get('generated-table.docx') as DocxApplyRecord
          return {
            recordNames: records.map((item) => item.source_name),
            record,
            diffXml: await readDocumentXml(record.preview_diff_artifact_path),
            tableRecord,
            tableDiffXml: await readDocumentXml(tableRecord.preview_diff_artifact_path),
            removedSourceXml: await readDocumentXml(
              `${runtime.workspaceRoot}/generated-removed.docx`
            )
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        const green = count(result.diffXml, 'w:fill="E9F7EF"')
        runtime.assertThat(
          JSON.stringify(result.recordNames) ===
            JSON.stringify(['generated-final.docx', 'generated-table.docx']) &&
            count(result.diffXml, '新增初稿') === 0 &&
            count(result.diffXml, '新增终稿') === 1 &&
            green === 1 &&
            count(result.diffXml, 'w:fill="FDECEC"') === 0 &&
            result.record.change_count === 1 &&
            result.record.insert_count === 1 &&
            result.record.delete_count === 0 &&
            count(result.tableDiffXml, '单元格初稿') === 0 &&
            count(result.tableDiffXml, '单元格终稿') === 1 &&
            result.tableRecord.change_count === 1 &&
            result.tableRecord.insert_count === 1 &&
            result.tableRecord.delete_count === 0 &&
            !result.removedSourceXml.includes('临时新增'),
          {
            name: 'docx-generated-block-diff-keeps-only-final-visible-node',
            message: '新增 block 多轮编辑后只显示最终绿色版本，新增后删除不得生成净变化记录。',
            data: {
              recordNames: result.recordNames,
              green,
              record: result.record,
              tableRecord: result.tableRecord
            }
          }
        )
      }
    })
  })
})
