import { describe, it } from 'vitest'
import {
  createDocxToolHarness,
  writeTestDocxFile
} from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import {
  type DocxApplyOpsResult,
  type DocxGetBlockResult,
  type DocxOpenResult,
  type DocxOutlineResult,
  type DocxSearchResult,
  type DocxValidateResult,
  findParagraphBlockIdByText,
  findTableCellBlockIdByText
} from './testUtils'

describe('ai tool docx backend', () => {
  it('docx-format-variants-contract', async () => {
    await runBackendCase({
      caseId: 'docx-format-variants-contract',
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
          const opened = await harness.invoke<DocxOpenResult>('docx_open', {
            sourcePath: 'format-variants.docx'
          })
          const outline = await harness.invoke<DocxOutlineResult>('docx_outline', {
            docId: opened.docId,
            includeTables: true,
            includeCells: true,
            maxBlocks: 40
          })

          const headingBlockId = findParagraphBlockIdByText(outline.blocks, 'Weekly Format Variants')
          const narrativeBlockId = findParagraphBlockIdByText(
            outline.blocks,
            'Narrative paragraph content.'
          )
          const ownerCellBlockId = findTableCellBlockIdByText(outline.blocks, 'Alice')

          const headingBlock = await harness.invoke<DocxGetBlockResult>('docx_get_block', {
            docId: opened.docId,
            blockId: headingBlockId
          })
          const ownerCellBlock = await harness.invoke<DocxGetBlockResult>('docx_get_block', {
            docId: opened.docId,
            blockId: ownerCellBlockId
          })
          const applied = await harness.invoke<DocxApplyOpsResult>('docx_apply_ops', {
            docId: opened.docId,
            ops: [
              {
                type: 'replace_block',
                blockId: narrativeBlockId,
                content: {
                  kind: 'paragraph',
                  runs: [{ text: 'Narrative paragraph updated.' }]
                }
              },
              {
                type: 'update_table_cell',
                blockId: ownerCellBlockId,
                content: [
                  {
                    kind: 'paragraph',
                    runs: [{ text: 'Bob' }]
                  }
                ]
              }
            ]
          })
          const search = await harness.invoke<DocxSearchResult>('docx_search', {
            docId: applied.newDocId,
            query: 'Narrative paragraph updated.',
            mode: 'literal'
          })
          const validated = await harness.invoke<DocxValidateResult>('docx_validate', {
            docId: applied.newDocId
          })

          return {
            outline,
            headingBlock,
            ownerCellBlock,
            applied,
            search,
            validated
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
            result.headingBlock.block.type === 'paragraph' &&
            result.ownerCellBlock.block.type === 'table_cell',
          {
            name: 'format-variants-return-stable-block-types',
            message: 'heading、paragraph、table 和 table_cell 都应被稳定识别和读取。',
            data: {
              outline: result.outline.blocks,
              headingBlock: result.headingBlock.block,
              ownerCellBlock: result.ownerCellBlock.block
            }
          }
        )

        runtime.assertThat(
          result.applied.changedBlocks.length === 2 &&
            result.search.matches.length === 1 &&
            result.validated.problems.length === 0 &&
            result.applied.changedBlocks.some((block) => block.action === 'update_table_cell'),
          {
            name: 'format-variants-support-updating-paragraph-and-cell',
            message: 'paragraph 与 table_cell 修改后，结构仍应有效且可继续消费。',
            data: {
              changedBlocks: result.applied.changedBlocks,
              validationProblems: result.validated.problems,
              searchMatches: result.search.matches
            }
          }
        )
      }
    })
  })
})
