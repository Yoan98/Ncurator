import { describe, it } from 'vitest'
import {
  createDocxToolHarness,
  docxParagraphNode,
  writeRichTestDocxFile
} from '../../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../../harness/backend/run-backend-case'
import type { DocxMutationResult, DocxOutlineResult, DocxReadResult } from '../testUtils'

describe('ai tool docx backend', () => {
  it('docx-insert-after-preserves-anchor-xml', async () => {
    await runBackendCase({
      caseId: 'docx-insert-after-preserves-anchor-xml',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx', 'write-stability'],
      description: '验证纯 insert_after 不会改写 anchor 段落文本与 run 格式。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeRichTestDocxFile(runtime.workspaceRoot, 'insert-after-preserves-anchor.docx', [
          {
            type: 'paragraph',
            paragraph: {
              runs: [
                { text: 'Anchor ', bold: true },
                { text: 'styled ', color: '2563EB' },
                { text: 'sentence', underline: true }
              ]
            }
          },
          {
            type: 'paragraph',
            paragraph: {
              runs: [{ text: 'Tail paragraph.' }]
            }
          }
        ])

        const harness = createDocxToolHarness(runtime)
        try {
          const outline = await harness.invoke<DocxOutlineResult>('docx_read_outline', {
            sourcePath: 'insert-after-preserves-anchor.docx',
            ranges: [{ type: 'block_index', fromBlockIndex: 0, toBlockIndex: 19 }]
          })
          const anchorBlockId =
            outline.blocks.find(
              (block) => block.type === 'paragraph' && block.text.includes('Anchor styled sentence')
            )?.blockId || ''

          const anchorBefore = await harness.invoke<DocxReadResult>('docx_read_blocks', {
            sourcePath: 'insert-after-preserves-anchor.docx',
            range: { type: 'block_ids', blockIds: [anchorBlockId] }
          })
          const inserted = await harness.invoke<DocxMutationResult>('docx_edit', {
            sourcePath: 'insert-after-preserves-anchor.docx',
            actions: [
              {
                type: 'insert_blocks',

                location: { blockId: anchorBlockId, position: 'after' },
                blocks: [docxParagraphNode('Inserted explanation.')]
              }
            ]
          })
          const anchorAfter = await harness.invoke<DocxReadResult>('docx_read_blocks', {
            sourcePath: inserted.sourcePath,
            range: { type: 'block_ids', blockIds: [anchorBlockId] }
          })

          return {
            anchorBefore: anchorBefore.blocks[0],
            anchorAfter: anchorAfter.blocks[0],
            inserted
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.anchorBefore?.type === 'paragraph' &&
            result.anchorAfter?.type === 'paragraph' &&
            result.anchorBefore.text === result.anchorAfter.text &&
            JSON.stringify(result.anchorBefore.runs) === JSON.stringify(result.anchorAfter.runs) &&
            result.inserted.changedBlocks.some((block) => block.action === 'insert_after'),
          {
            name: 'insert-after-preserves-anchor-runs',
            message: '纯 insert_after 后，anchor 段落的文本和 run 样式都应保持不变。',
            data: {
              anchorBefore: result.anchorBefore,
              anchorAfter: result.anchorAfter,
              changedBlocks: result.inserted.changedBlocks
            }
          }
        )
      }
    })
  })
})
