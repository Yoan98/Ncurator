import fs from 'node:fs/promises'
import { describe, it } from 'vitest'
import {
  buildBlockIndex,
  loadDocxBundle
} from '../../../../../../src/main/services/ai/human/tools/docx/adapters/ooxml/blockIndex'
import {
  createDocxToolHarness,
  docxParagraphNode,
  docxTableNode,
  writeRichTestDocxFile
} from '../../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../../harness/backend/run-backend-case'
import type { DocxMutationResult, DocxOutlineResult, DocxReadResult } from '../testUtils'

describe('ai tool docx backend', () => {
  it('docx-insert-does-not-duplicate-downstream-blocks', async () => {
    await runBackendCase({
      caseId: 'docx-insert-does-not-duplicate-downstream-blocks',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx', 'write-stability'],
      description: '验证结构插入后的 review projection 不会重复下游旧段落。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const sourcePath = await writeRichTestDocxFile(
          runtime.workspaceRoot,
          'insert-after-no-duplicate-tail.docx',
          [
            {
              type: 'paragraph',
              paragraph: {
                runs: [
                  { text: '学生可以通过', bold: true },
                  { text: '点击对话中的按钮', color: '2563EB' },
                  { text: '进入引导流程。', underline: true }
                ]
              }
            },
            {
              type: 'paragraph',
              paragraph: {
                runs: [{ text: '学生端脚手架引导：' }]
              }
            },
            {
              type: 'paragraph',
              paragraph: {
                runs: [{ text: '引导完成后进入正式练习。' }]
              }
            }
          ]
        )

        const harness = createDocxToolHarness(runtime)
        try {
          harness.ctx.beginDocxApplyRun()
          const outlineBefore = await harness.invoke<DocxOutlineResult>('docx_read_outline', {
            sourcePath: 'insert-after-no-duplicate-tail.docx',
            ranges: [{ type: 'block_index', fromBlockIndex: 0, toBlockIndex: 49 }]
          })
          const anchorBlockId =
            outlineBefore.blocks.find(
              (block) =>
                block.type === 'paragraph' &&
                block.text.includes('学生可以通过点击对话中的按钮进入引导流程。')
            )?.blockId || ''

          const anchorBefore = await harness.invoke<DocxReadResult>('docx_read_blocks', {
            sourcePath: 'insert-after-no-duplicate-tail.docx',
            range: { type: 'block_ids', blockIds: [anchorBlockId] }
          })
          const insertedParagraph = await harness.invoke<DocxMutationResult>('docx_edit', {
            sourcePath: 'insert-after-no-duplicate-tail.docx',
            actions: [
              {
                type: 'insert_blocks',
                anchorBlockId,
                position: 'after',
                blocks: [docxParagraphNode('学生可以根据按钮提示逐步完成脚手架操作。')]
              }
            ]
          })
          const insertedParagraphBlockId =
            insertedParagraph.createdBlocks?.find((block) => block.type === 'paragraph')?.blockId ||
            ''
          const insertedTable = await harness.invoke<DocxMutationResult>('docx_edit', {
            sourcePath: insertedParagraph.sourcePath,
            actions: [
              {
                type: 'insert_blocks',
                anchorBlockId: insertedParagraphBlockId,
                position: 'after',
                blocks: [
                  docxTableNode([
                    ['入口按钮', '对应动作'],
                    ['开始引导', '进入脚手架']
                  ])
                ]
              }
            ]
          })
          const anchorAfter = await harness.invoke<DocxReadResult>('docx_read_blocks', {
            sourcePath: insertedTable.sourcePath,
            range: { type: 'block_ids', blockIds: [anchorBlockId] }
          })
          const records = await harness.ctx.applyDocxRunEdits()
          if (records.length < 1) throw new Error('expected docx apply record')

          const reviewBundle = await loadDocxBundle(await fs.readFile(sourcePath))
          const reviewOutline = buildBlockIndex(reviewBundle.documentDom)
            .outline.filter((block) => block.type !== 'table_cell')
            .map((block) => ({
              type: block.type,
              text: block.type === 'table' ? block.preview : block.text
            }))

          return {
            anchorBefore: anchorBefore.blocks[0],
            anchorAfter: anchorAfter.blocks[0],
            records,
            reviewOutline
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.anchorBefore?.type === 'paragraph' &&
            result.anchorAfter?.type === 'paragraph' &&
            JSON.stringify(result.anchorBefore.runs) === JSON.stringify(result.anchorAfter.runs),
          {
            name: 'anchor-runs-remain-identical-after-structural-insert',
            message: '结构插入后，anchor 原段落的 run 样式不应发生漂移。',
            data: {
              anchorBefore: result.anchorBefore,
              anchorAfter: result.anchorAfter
            }
          }
        )

        runtime.assertThat(
          result.reviewOutline.filter((block) =>
            String(block.text || '').includes('学生端脚手架引导：')
          ).length === 1,
          {
            name: 'review-does-not-duplicate-downstream-tail-block',
            message: 'review artifact 中下游旧段落只应出现一次，不得因插入重绑错误而重复。',
            data: {
              reviewOutline: result.reviewOutline
            }
          }
        )
      }
    })
  })
})
