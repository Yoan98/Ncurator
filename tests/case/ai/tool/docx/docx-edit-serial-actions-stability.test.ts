import { describe, it } from 'vitest'
import {
  createDocxToolHarness,
  docxParagraphNode,
  writeTestDocxFile
} from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import {
  type DocxFailureResult,
  type DocxMutationResult,
  type DocxOutlineResult,
  findParagraphBlockIdByText
} from './testUtils'

describe('ai tool docx backend', () => {
  it('docx-edit-serial-actions-resolve-original-target-after-insert-drift', async () => {
    await runBackendCase({
      caseId: 'docx-edit-serial-actions-resolve-original-target-after-insert-drift',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description:
        '验证 docx_edit(actions) 按顺序执行时，前序插入导致 blockIndex 漂移后仍能命中后续原始 blockId。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(runtime.workspaceRoot, 'serial-drift-insert.docx', [
          { type: 'paragraph', text: 'A' },
          { type: 'paragraph', text: 'B' },
          { type: 'paragraph', text: 'C' }
        ])

        const harness = createDocxToolHarness(runtime)
        try {
          const before = await harness.invoke<DocxOutlineResult>('docx_read_outline', {
            sourcePath: 'serial-drift-insert.docx',
            ranges: [{ type: 'block_index', fromBlockIndex: 0, toBlockIndex: 10 }]
          })
          const anchorA = findParagraphBlockIdByText(before.blocks, 'A')
          const targetC = findParagraphBlockIdByText(before.blocks, 'C')
          const edited = await harness.invoke<DocxMutationResult>('docx_edit', {
            sourcePath: before.sourcePath,
            actions: [
              {
                type: 'insert_blocks',
                position: 'after',
                anchorBlockId: anchorA,
                blocks: [docxParagraphNode('A1')]
              },
              {
                type: 'replace_block',
                blockId: targetC,
                block: docxParagraphNode('C updated')
              }
            ]
          })
          const after = await harness.invoke<DocxOutlineResult>('docx_read_outline', {
            sourcePath: edited.sourcePath,
            ranges: [{ type: 'block_index', fromBlockIndex: 0, toBlockIndex: 10 }]
          })
          return { edited, after }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        const bodyTexts = result.after.blocks
          .filter((block) => block.type !== 'table_cell')
          .map((block) => block.text)

        runtime.assertThat(
          JSON.stringify(bodyTexts) === JSON.stringify(['A', 'A1', 'B', 'C updated']) &&
            result.edited.changedBlocks.some((block) => block.action === 'insert_after') &&
            result.edited.changedBlocks.some((block) => block.action === 'replace_block') &&
            Array.isArray(result.edited.postWriteReadback?.regions),
          {
            name: 'serial-actions-resolve-original-target-after-insert-drift',
            message:
              '前序插入后，后序 replace_block 仍应命中最初 read 到的 C，而不是漂移到其他 block。',
            data: {
              bodyTexts,
              changedBlocks: result.edited.changedBlocks,
              postWriteReadback: result.edited.postWriteReadback
            }
          }
        )
      }
    })
  })

  it('docx-edit-serial-actions-follow-replacement-successor', async () => {
    await runBackendCase({
      caseId: 'docx-edit-serial-actions-follow-replacement-successor',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description:
        '验证同一次 docx_edit 内 replace_block 后继续引用同一原始 blockId，会解析到 replacement successor。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(runtime.workspaceRoot, 'serial-successor.docx', [
          { type: 'paragraph', text: 'Target old.' },
          { type: 'paragraph', text: 'Tail.' }
        ])

        const harness = createDocxToolHarness(runtime)
        try {
          const before = await harness.invoke<DocxOutlineResult>('docx_read_outline', {
            sourcePath: 'serial-successor.docx',
            ranges: [{ type: 'block_index', fromBlockIndex: 0, toBlockIndex: 10 }]
          })
          const target = findParagraphBlockIdByText(before.blocks, 'Target old.')
          const edited = await harness.invoke<DocxMutationResult>('docx_edit', {
            sourcePath: before.sourcePath,
            actions: [
              {
                type: 'replace_block',
                blockId: target,
                block: docxParagraphNode('Target new keyword.')
              },
              {
                type: 'replace_text',
                blockIds: [target],
                query: 'keyword',
                replace: 'styled-keyword'
              }
            ]
          })
          const after = await harness.invoke<DocxOutlineResult>('docx_read_outline', {
            sourcePath: edited.sourcePath,
            ranges: [{ type: 'block_index', fromBlockIndex: 0, toBlockIndex: 10 }]
          })
          return { edited, after }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        const bodyTexts = result.after.blocks
          .filter((block) => block.type !== 'table_cell')
          .map((block) => block.text)

        runtime.assertThat(
          JSON.stringify(bodyTexts) === JSON.stringify(['Target new styled-keyword.', 'Tail.']) &&
            result.edited.changedBlocks.some((block) => block.action === 'replace_block') &&
            result.edited.changedBlocks.some((block) => block.action === 'replace_text'),
          {
            name: 'serial-actions-follow-replacement-successor',
            message: 'replace_block 后继续引用同一原始 blockId，应解析到替换后的新 block。',
            data: {
              bodyTexts,
              changedBlocks: result.edited.changedBlocks
            }
          }
        )
      }
    })
  })

  it('docx-edit-serial-actions-fail-after-delete-without-committing', async () => {
    await runBackendCase({
      caseId: 'docx-edit-serial-actions-fail-after-delete-without-committing',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description:
        '验证同一次 docx_edit 内删除后再修改同一原始 block 会失败，且不注册部分写入结果。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(runtime.workspaceRoot, 'serial-delete-failure.docx', [
          { type: 'paragraph', text: 'Keep' },
          { type: 'paragraph', text: 'Delete target' }
        ])

        const harness = createDocxToolHarness(runtime)
        try {
          const before = await harness.invoke<DocxOutlineResult>('docx_read_outline', {
            sourcePath: 'serial-delete-failure.docx',
            ranges: [{ type: 'block_index', fromBlockIndex: 0, toBlockIndex: 10 }]
          })
          const target = findParagraphBlockIdByText(before.blocks, 'Delete target')
          const failed = await harness.invoke<DocxFailureResult | DocxMutationResult>('docx_edit', {
            sourcePath: before.sourcePath,
            actions: [
              {
                type: 'delete_blocks',
                blockIds: [target]
              },
              {
                type: 'replace_block',
                blockId: target,
                block: docxParagraphNode('Should not appear')
              }
            ]
          })
          const after = await harness.invoke<DocxOutlineResult>('docx_read_outline', {
            sourcePath: before.sourcePath,
            ranges: [{ type: 'block_index', fromBlockIndex: 0, toBlockIndex: 10 }]
          })
          return { failed, after }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        const bodyTexts = result.after.blocks
          .filter((block) => block.type !== 'table_cell')
          .map((block) => block.text)
        const failure = result.failed as DocxFailureResult

        runtime.assertThat(
          typeof failure.error === 'string' &&
            bodyTexts.includes('Delete target') &&
            !bodyTexts.includes('Should not appear'),
          {
            name: 'serial-actions-fail-after-delete-without-committing',
            message:
              '同一次 actions 内删除后再改同一目标应失败，且 active 文档不应进入部分写入状态。',
            data: {
              failure,
              bodyTexts
            }
          }
        )
      }
    })
  })
})
