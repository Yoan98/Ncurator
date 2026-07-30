import { describe, it } from 'vitest'
import {
  createDocxToolHarness,
  docxParagraphNode,
  docxTableNode,
  writeTestDocxFile
} from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import {
  type DocxMutationResult,
  type DocxOutlineResult,
  findParagraphBlockIdByText
} from './testUtils'

describe('ai tool docx backend', () => {
  it('docx-structural-op-behavior', async () => {
    await runBackendCase({
      caseId: 'docx-structural-op-behavior',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证文本编辑不创建新结构，段落/表格对象编辑可创建新的结构块。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(runtime.workspaceRoot, 'structural-op-behavior.docx', [
          {
            type: 'heading',
            text: 'Structure Test',
            level: 1
          },
          {
            type: 'paragraph',
            text: 'Anchor text.'
          },
          {
            type: 'paragraph',
            text: 'Tail text.'
          }
        ])

        const harness = createDocxToolHarness(runtime)
        try {
          const outlineBefore = await harness.invoke<DocxOutlineResult>('docx_read_outline', {
            sourcePath: 'structural-op-behavior.docx',
            ranges: [{ type: 'block_index', fromBlockIndex: 0, toBlockIndex: 49 }]
          })
          const anchorBlockId = findParagraphBlockIdByText(outlineBefore.blocks, 'Anchor text.')

          const replaceResult = await harness.invoke<DocxMutationResult>('docx_edit', {
            sourcePath: outlineBefore.sourcePath,
            actions: [
              {
                type: 'replace_text',
                query: 'Anchor text.',
                replace: 'Anchor text updated.'
              }
            ]
          })
          const outlineAfterReplace = await harness.invoke<DocxOutlineResult>('docx_read_outline', {
            sourcePath: replaceResult.sourcePath,
            ranges: [{ type: 'block_index', fromBlockIndex: 0, toBlockIndex: 49 }]
          })

          const insertParagraph = await harness.invoke<DocxMutationResult>('docx_edit', {
            sourcePath: replaceResult.sourcePath,
            actions: [
              {
                type: 'insert_blocks',
                position: 'after',
                anchorBlockId,
                blocks: [docxParagraphNode('Extra explanation paragraph.')]
              }
            ]
          })
          const paragraphBlockId = insertParagraph.createdBlocks?.[0]?.blockId || anchorBlockId
          const insertTable = await harness.invoke<DocxMutationResult>('docx_edit', {
            sourcePath: insertParagraph.sourcePath,
            actions: [
              {
                type: 'insert_blocks',
                position: 'after',
                anchorBlockId: paragraphBlockId,
                blocks: [docxTableNode([['反走样', '过拟合']])]
              }
            ]
          })
          const outlineAfterInsert = await harness.invoke<DocxOutlineResult>('docx_read_outline', {
            sourcePath: insertTable.sourcePath,
            ranges: [{ type: 'block_index', fromBlockIndex: 0, toBlockIndex: 79 }]
          })

          return {
            outlineBefore,
            replaceResult,
            outlineAfterReplace,
            insertParagraph,
            insertTable,
            outlineAfterInsert
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.replaceResult.changedBlocks.every((block) => block.action === 'replace_text') &&
            result.outlineAfterReplace.blocks.filter((block) => block.type !== 'table_cell')
              .length ===
              result.outlineBefore.blocks.filter((block) => block.type !== 'table_cell').length &&
            !result.outlineAfterReplace.blocks.some((block) => block.type === 'table'),
          {
            name: 'replace-text-does-not-create-new-block-structure',
            message:
              'docx_edit(replace_text) 只应修改现有文本，不应凭空创建新的 paragraph/table 结构。',
            data: {
              outlineBefore: result.outlineBefore.blocks,
              outlineAfterReplace: result.outlineAfterReplace.blocks,
              changedBlocks: result.replaceResult.changedBlocks
            }
          }
        )

        runtime.assertThat(
          result.insertParagraph.changedBlocks.some((block) => block.action === 'insert_after') &&
            result.insertTable.changedBlocks.some((block) => block.action === 'insert_after') &&
            result.outlineAfterInsert.blocks.some(
              (block) =>
                block.type === 'paragraph' && block.text.includes('Extra explanation paragraph.')
            ) &&
            result.outlineAfterInsert.blocks.some((block) => block.type === 'table') &&
            result.outlineAfterInsert.blocks.length > result.outlineAfterReplace.blocks.length,
          {
            name: 'object-edit-can-create-paragraph-and-table-structure',
            message: '段落和表格对象编辑应能新增独立结构，而不是把内容并入原 block。',
            data: {
              outlineAfterReplace: result.outlineAfterReplace.blocks,
              outlineAfterInsert: result.outlineAfterInsert.blocks,
              paragraphEdit: result.insertParagraph.changedBlocks,
              tableEdit: result.insertTable.changedBlocks
            }
          }
        )
      }
    })
  })
})
