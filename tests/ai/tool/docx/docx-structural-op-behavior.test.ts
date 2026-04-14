import { describe, it } from 'vitest'
import {
  createDocxToolHarness,
  writeTestDocxFile
} from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import {
  type DocxApplyOpsResult,
  type DocxOpenResult,
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
      description: '验证 replace_text 不创建新结构，insert_after 可创建新的 paragraph/table 结构。',
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
          const opened = await harness.invoke<DocxOpenResult>('docx_open', {
            sourcePath: 'structural-op-behavior.docx'
          })
          const outlineBefore = await harness.invoke<DocxOutlineResult>('docx_outline', {
            sourcePath: opened.sourcePath,
            includeTables: true,
            includeCells: true,
            maxBlocks: 50
          })
          const anchorBlockId = findParagraphBlockIdByText(outlineBefore.blocks, 'Anchor text.')

          const replaceResult = await harness.invoke<DocxApplyOpsResult>('docx_apply_ops', {
            sourcePath: opened.sourcePath,
            ops: [
              {
                type: 'replace_text',
                query: 'Anchor text.',
                replace: 'Anchor text updated.'
              }
            ]
          })
          const outlineAfterReplace = await harness.invoke<DocxOutlineResult>('docx_outline', {
            sourcePath: replaceResult.sourcePath,
            includeTables: true,
            includeCells: true,
            maxBlocks: 50
          })

          const insertResult = await harness.invoke<DocxApplyOpsResult>('docx_apply_ops', {
            sourcePath: replaceResult.sourcePath,
            ops: [
              {
                type: 'insert_after',
                anchorBlockId,
                content: [
                  {
                    kind: 'paragraph',
                    runs: [{ text: 'Extra explanation paragraph.' }]
                  },
                  {
                    kind: 'table',
                    rows: [
                      [
                        {
                          paragraphs: [
                            {
                              kind: 'paragraph',
                              runs: [{ text: '反走样' }]
                            }
                          ]
                        },
                        {
                          paragraphs: [
                            {
                              kind: 'paragraph',
                              runs: [{ text: '过拟合' }]
                            }
                          ]
                        }
                      ]
                    ]
                  }
                ]
              }
            ]
          })
          const outlineAfterInsert = await harness.invoke<DocxOutlineResult>('docx_outline', {
            sourcePath: insertResult.sourcePath,
            includeTables: true,
            includeCells: true,
            maxBlocks: 80
          })

          return {
            outlineBefore,
            replaceResult,
            outlineAfterReplace,
            insertResult,
            outlineAfterInsert
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.replaceResult.changedBlocks.every((block) => block.action === 'replace_text') &&
            result.outlineAfterReplace.blocks.filter((block) => block.type !== 'table_cell').length ===
              result.outlineBefore.blocks.filter((block) => block.type !== 'table_cell').length &&
            !result.outlineAfterReplace.blocks.some((block) => block.type === 'table'),
          {
            name: 'replace-text-does-not-create-new-block-structure',
            message: 'replace_text 只应修改现有文本，不应凭空创建新的 paragraph/table 结构。',
            data: {
              outlineBefore: result.outlineBefore.blocks,
              outlineAfterReplace: result.outlineAfterReplace.blocks,
              changedBlocks: result.replaceResult.changedBlocks
            }
          }
        )

        runtime.assertThat(
          result.insertResult.changedBlocks.some((block) => block.action === 'insert_after') &&
            result.outlineAfterInsert.blocks.some(
              (block) => block.type === 'paragraph' && block.text.includes('Extra explanation paragraph.')
            ) &&
            result.outlineAfterInsert.blocks.some((block) => block.type === 'table') &&
            result.outlineAfterInsert.blocks.length > result.outlineAfterReplace.blocks.length,
          {
            name: 'insert-after-can-create-paragraph-and-table-structure',
            message: 'insert_after 应能新增独立 paragraph/table 结构，而不是把内容并入原 block。',
            data: {
              outlineAfterReplace: result.outlineAfterReplace.blocks,
              outlineAfterInsert: result.outlineAfterInsert.blocks,
              changedBlocks: result.insertResult.changedBlocks
            }
          }
        )
      }
    })
  })
})
