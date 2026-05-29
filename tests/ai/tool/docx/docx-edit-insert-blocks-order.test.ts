import { describe, it } from 'vitest'
import {
  createDocxToolHarness,
  writeTestDocxFile
} from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import {
  type DocxMutationResult,
  type DocxOutlineResult,
  findParagraphBlockIdByText
} from './testUtils'

describe('ai tool docx backend', () => {
  it('docx-edit-insert-blocks-order', async () => {
    await runBackendCase({
      caseId: 'docx-edit-insert-blocks-order',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证 docx_edit insert_blocks 在同一 anchor 后插入多条内容时保持输入顺序。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(runtime.workspaceRoot, 'insert-blocks-order.docx', [
          { type: 'paragraph', text: 'A' },
          { type: 'paragraph', text: 'B' }
        ])

        const harness = createDocxToolHarness(runtime)
        try {
          const before = await harness.invoke<DocxOutlineResult>('docx_outline', {
            sourcePath: 'insert-blocks-order.docx',
            ranges: [{ type: 'block_index', fromBlockIndex: 0, toBlockIndex: 10 }]
          })
          const anchorBlockId = findParagraphBlockIdByText(before.blocks, 'A')
          const inserted = await harness.invoke<DocxMutationResult>('docx_edit', {
            sourcePath: 'insert-blocks-order.docx',
            actions: [{
              type: 'insert_blocks',
              position: 'after',
              anchorBlockId,
              blocks: [
              { type: 'paragraph', text: 'P1' },
              { type: 'paragraph', text: 'P2' },
              { type: 'table', rows: [['T1', 'T2']] },
              { type: 'paragraph', text: 'P3' }
            ]
            }]
          })
          const after = await harness.invoke<DocxOutlineResult>('docx_outline', {
            sourcePath: 'insert-blocks-order.docx',
            ranges: [{ type: 'block_index', fromBlockIndex: 0, toBlockIndex: 20 }]
          })

          return { inserted, after }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        const bodyTexts = result.after.blocks
          .filter((block) => block.type !== 'table_cell')
          .map((block) => block.text)

        runtime.assertThat(
          JSON.stringify(bodyTexts) === JSON.stringify(['A', 'P1', 'P2', 'T1 | T2', 'P3', 'B']) &&
            (result.inserted.createdBlocks || []).length >= 4 &&
            Array.isArray(result.inserted.postWriteReadback?.regions),
          {
            name: 'insert-blocks-preserves-input-order',
            message: '在 A 后插入 P1/P2/Table/P3 时，最终顺序必须稳定为 A/P1/P2/Table/P3/B。',
            data: {
              bodyTexts,
              inserted: result.inserted
            }
          }
        )
      }
    })
  })

  it('docx-edit-serial-multiple-inserts-preserve-created-blocks', async () => {
    await runBackendCase({
      caseId: 'docx-edit-serial-multiple-inserts-preserve-created-blocks',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证一次 docx_edit(actions) 内多个 insert_blocks 会按 action 顺序稳定写入并返回各自 createdBlocks。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(runtime.workspaceRoot, 'batch-multi-insert.docx', [
          { type: 'paragraph', text: 'A' },
          { type: 'paragraph', text: 'B' },
          { type: 'paragraph', text: 'C' }
        ])

        const harness = createDocxToolHarness(runtime)
        try {
          const before = await harness.invoke<DocxOutlineResult>('docx_outline', {
            sourcePath: 'batch-multi-insert.docx',
            ranges: [{ type: 'block_index', fromBlockIndex: 0, toBlockIndex: 10 }]
          })
          const anchorA = findParagraphBlockIdByText(before.blocks, 'A')
          const anchorC = findParagraphBlockIdByText(before.blocks, 'C')
          const inserted = await harness.invoke<DocxMutationResult>('docx_edit', {
            sourcePath: 'batch-multi-insert.docx',
            actions: [
              {
                type: 'insert_blocks',
                position: 'after',
                anchorBlockId: anchorA,
                blocks: [
                  { type: 'paragraph', text: 'A1' },
                  { type: 'paragraph', text: 'A2' }
                ]
              },
              {
                type: 'insert_blocks',
                position: 'before',
                anchorBlockId: anchorC,
                blocks: [
                  { type: 'paragraph', text: 'C-1' },
                  { type: 'table', rows: [['T1', 'T2']] }
                ]
              }
            ]
          })
          const after = await harness.invoke<DocxOutlineResult>('docx_outline', {
            sourcePath: 'batch-multi-insert.docx',
            ranges: [{ type: 'block_index', fromBlockIndex: 0, toBlockIndex: 20 }]
          })
          return { inserted, after }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        const bodyTexts = result.after.blocks
          .filter((block) => block.type !== 'table_cell')
          .map((block) => block.text)
        const createdTexts = new Set(
          (result.inserted.createdBlocks || [])
            .map((created) => result.after.blocks.find((block) => block.blockId === created.blockId)?.text)
            .filter((text): text is string => Boolean(text))
        )

        runtime.assertThat(
          JSON.stringify(bodyTexts) === JSON.stringify(['A', 'A1', 'A2', 'B', 'C-1', 'T1 | T2', 'C']) &&
            ['A1', 'A2', 'C-1', 'T1 | T2'].every((text) => createdTexts.has(text)),
          {
            name: 'serial-multiple-inserts-preserve-created-blocks',
            message: '一次 actions 内多个插入应按串行语义稳定落位，并正确返回新增 block。',
            data: {
              bodyTexts,
              createdBlocks: result.inserted.createdBlocks,
              createdTexts: [...createdTexts]
            }
          }
        )
      }
    })
  })
})
