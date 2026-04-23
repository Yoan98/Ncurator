import { describe, it } from 'vitest'
import {
  createDocxToolHarness,
  writeTestDocxFile
} from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import type { DocxMutationResult, DocxOutlineResult } from '../testUtils'

describe('ai tool docx backend', () => {
  it('docx-inserted-table-created-blocks-include-table-and-cells', async () => {
    await runBackendCase({
      caseId: 'docx-inserted-table-created-blocks-include-table-and-cells',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx', 'write-stability'],
      description: '验证表格插入后的 createdBlocks 同时包含 table 与其 table_cell。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(runtime.workspaceRoot, 'inserted-table-created-blocks.docx', [
          { type: 'paragraph', text: 'Anchor paragraph.' },
          { type: 'paragraph', text: 'Tail paragraph.' }
        ])

        const harness = createDocxToolHarness(runtime)
        try {
          const outline = await harness.invoke<DocxOutlineResult>('docx_outline', {
            sourcePath: 'inserted-table-created-blocks.docx',
            maxBlocks: 20
          })
          const anchorBlockId =
            outline.blocks.find(
              (block) => block.type === 'paragraph' && block.preview.includes('Anchor paragraph.')
            )?.blockId || ''

          const insertedTable = await harness.invoke<DocxMutationResult>('docx_table_edit', {
            sourcePath: 'inserted-table-created-blocks.docx',
            action: 'insert_after',
            anchorBlockId,
            rows: [
              ['A', 'B'],
              ['C', 'D']
            ]
          })

          return {
            insertedTable
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        const tableCount =
          result.insertedTable.createdBlocks?.filter((block) => block.type === 'table').length || 0
        const cellCount =
          result.insertedTable.createdBlocks?.filter((block) => block.type === 'table_cell').length || 0
        runtime.assertThat(
          tableCount === 1 && cellCount === 4,
          {
            name: 'inserted-table-created-blocks-include-table-and-cells',
            message: '表格插入后，createdBlocks 应包含 1 个 table 和全部 4 个 table_cell。',
            data: {
              createdBlocks: result.insertedTable.createdBlocks
            }
          }
        )
      }
    })
  })
})
