import { describe, it } from 'vitest'
import {
  createDocxToolHarness,
  docxParagraphNode,
  docxTableNode,
  writeTestDocxFile
} from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import type { DocxMutationResult, DocxOutlineResult, DocxSearchResult } from './testUtils'

describe('ai tool docx backend', () => {
  it('docx-multi-round-created-block-edit', async () => {
    await runBackendCase({
      caseId: 'docx-multi-round-created-block-edit',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证第 2/3 轮可以继续编辑第 1 轮新增的段落和表格单元格。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(runtime.workspaceRoot, 'multi-round-created.docx', [
          { type: 'paragraph', text: '开头段落。' },
          { type: 'paragraph', text: '锚点段落。' }
        ])

        const harness = createDocxToolHarness(runtime)
        try {
          const outline = await harness.invoke<DocxOutlineResult>('docx_read_outline', {
            sourcePath: 'multi-round-created.docx'
          })
          const anchorBlockId =
            outline.blocks.find(
              (block) => block.type === 'paragraph' && block.text.includes('锚点段落')
            )?.blockId || ''

          const insertParagraph = await harness.invoke<DocxMutationResult>('docx_edit', {
            sourcePath: 'multi-round-created.docx',
            actions: [
              {
                type: 'insert_blocks',

                location: { blockId: anchorBlockId, position: 'after' },
                blocks: [docxParagraphNode('新增段落初稿。')]
              }
            ]
          })

          const insertedParagraphSearch = await harness.invoke<DocxSearchResult>('docx_search', {
            sourcePath: insertParagraph.sourcePath,
            query: '新增段落初稿。'
          })
          const insertedParagraphBlockId = insertedParagraphSearch.matches[0]?.blockId || ''

          const rewriteInsertedParagraph = await harness.invoke<DocxMutationResult>('docx_edit', {
            sourcePath: insertParagraph.sourcePath,
            actions: [
              {
                type: 'replace_text',
                query: '新增段落初稿。',
                replace: '新增段落二稿。',
                blockIds: [insertedParagraphBlockId]
              }
            ]
          })

          const insertTable = await harness.invoke<DocxMutationResult>('docx_edit', {
            sourcePath: rewriteInsertedParagraph.sourcePath,
            actions: [
              {
                type: 'insert_blocks',

                location: { blockId: insertedParagraphBlockId, position: 'after' },
                blocks: [
                  docxTableNode([
                    ['单元格初稿', '说明'],
                    ['保留项', '尾注']
                  ])
                ]
              }
            ]
          })

          const insertedCellSearch = await harness.invoke<DocxSearchResult>('docx_search', {
            sourcePath: insertTable.sourcePath,
            query: '单元格初稿'
          })
          const cellBlockId =
            insertedCellSearch.matches.find((match) => match.type === 'table_cell')?.blockId || ''

          const updateCreatedCell = await harness.invoke<DocxMutationResult>('docx_edit', {
            sourcePath: insertTable.sourcePath,
            actions: [
              {
                type: 'update_table_cell',
                cellBlockId,
                children: [docxParagraphNode('单元格终稿')]
              }
            ]
          })

          const rewrittenParagraphSearch = await harness.invoke<DocxSearchResult>('docx_search', {
            sourcePath: updateCreatedCell.sourcePath,
            query: '新增段落二稿。'
          })
          const updatedCellSearch = await harness.invoke<DocxSearchResult>('docx_search', {
            sourcePath: updateCreatedCell.sourcePath,
            query: '单元格终稿'
          })

          return {
            insertParagraph,
            insertedParagraphBlockId,
            rewriteInsertedParagraph,
            insertTable,
            cellBlockId,
            updateCreatedCell,
            rewrittenParagraphSearch,
            updatedCellSearch
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.insertParagraph.createdBlocks?.some((block) => block.type === 'paragraph') &&
            result.insertTable.createdBlocks?.some((block) => block.type === 'table'),
          {
            name: 'first-round-created-blocks-are-materialized',
            message: '首轮新增段落和后续新增表格都应真实落到 working draft 中。',
            data: {
              insertParagraph: result.insertParagraph.createdBlocks,
              insertTable: result.insertTable.createdBlocks
            }
          }
        )

        const canEditCreatedContent =
          result.rewriteInsertedParagraph.changedBlocks.length === 1 &&
          result.updateCreatedCell.changedBlocks.length === 1 &&
          result.rewrittenParagraphSearch.matches.length === 1 &&
          result.updatedCellSearch.matches.length >= 1 &&
          /^blk_[0-9a-f]{32}$/.test(result.insertedParagraphBlockId) &&
          /^blk_[0-9a-f]{32}$/.test(result.cellBlockId)
        runtime.assertThat(canEditCreatedContent, {
          name: 'later-rounds-can-edit-created-paragraph-and-cell',
          message:
            '第 2/3 轮应能继续编辑第 1 轮新增的段落与表格单元格，并且新内容可以继续被读取工具定位。',
          data: {
            insertedParagraphBlockId: result.insertedParagraphBlockId,
            cellBlockId: result.cellBlockId,
            rewriteInsertedParagraph: result.rewriteInsertedParagraph.changedBlocks,
            updateCreatedCell: result.updateCreatedCell.changedBlocks,
            rewrittenParagraphSearch: result.rewrittenParagraphSearch.matches,
            updatedCellSearch: result.updatedCellSearch.matches
          }
        })
      }
    })
  })
})
