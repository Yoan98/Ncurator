import fs from 'node:fs/promises'
import { describe, it } from 'vitest'
import {
  buildBlockIndex,
  loadDocxBundle
} from '../../../../../src/main/services/ai/human/tools/docx/adapters/ooxml/blockIndex'
import {
  createDocxToolHarness,
  writeRichTestDocxFile
} from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import type {
  DocxMutationResult,
  DocxOutlineResult,
  DocxReadResult
} from '../../../../ai/tool/docx/testUtils'

describe('temp ai tool docx backend', () => {
  it('docx-insert-after-live-regression-repro', async () => {
    await runBackendCase({
      caseId: 'docx-insert-after-live-regression-repro',
      harnessMode: 'tool-real',
      domain: 'temp',
      suite: 'ai',
      groups: ['tool', 'docx'],
      description: '最小复现 insert_after 导致 anchor 样式漂移、createdBlocks 误认尾块、review 重复旧段落的 live 回归。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeRichTestDocxFile(runtime.workspaceRoot, 'insert-after-live-repro.docx', [
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
        ])

        runtime.fileReviewService.beginRun({
          runId: runtime.runId,
          sessionId: 'docx-insert-after-live-regression-repro-session',
          inputText: '补充脚手架说明和对照表'
        })

        const harness = createDocxToolHarness(runtime)
        try {
          const outlineBefore = await harness.invoke<DocxOutlineResult>('docx_outline', {
            sourcePath: 'insert-after-live-repro.docx',
            ranges: [{ type: 'block_index', fromBlockIndex: 0, toBlockIndex: 49 }]
          })
          const anchorBlockId =
            outlineBefore.blocks.find(
              (block) =>
                block.type === 'paragraph' &&
                block.text.includes('学生可以通过点击对话中的按钮进入引导流程。')
            )?.blockId || ''

          const anchorBefore = await harness.invoke<DocxReadResult>('docx_read_blocks', {
            sourcePath: 'insert-after-live-repro.docx',
            range: { type: 'block_ids', blockIds: [anchorBlockId] }
          })

          const insertedParagraph = await harness.invoke<DocxMutationResult>('docx_edit', {
            sourcePath: 'insert-after-live-repro.docx',
            actions: [{
              type: 'insert_blocks',
              anchorBlockId,
              position: 'after',
              blocks: [
                {
                  type: 'paragraph',
                  text: '学生可以根据按钮提示逐步完成脚手架操作。'
                }
              ]
            }]
          })
          const insertedParagraphBlockId = insertedParagraph.createdBlocks?.find(
            (block) => block.type === 'paragraph'
          )?.blockId || ''

          const insertedTable = await harness.invoke<DocxMutationResult>('docx_edit', {
            sourcePath: insertedParagraph.sourcePath,
            actions: [{
              type: 'insert_blocks',
              anchorBlockId: insertedParagraphBlockId,
              position: 'after',
              blocks: [
                {
                  type: 'table',
                  rows: [
                    ['入口按钮', '对应动作'],
                    ['开始引导', '进入脚手架']
                  ]
                }
              ]
            }]
          })

          const anchorAfter = await harness.invoke<DocxReadResult>('docx_read_blocks', {
            sourcePath: insertedTable.sourcePath,
            range: { type: 'block_ids', blockIds: [anchorBlockId] }
          })
          const outlineAfter = await harness.invoke<DocxOutlineResult>('docx_outline', {
            sourcePath: insertedTable.sourcePath,
            ranges: [{ type: 'block_index', fromBlockIndex: 0, toBlockIndex: 79 }]
          })
          const createdPreviews = [
            ...(insertedParagraph.createdBlocks || []),
            ...(insertedTable.createdBlocks || [])
          ].map((created) => ({
            ...created,
            preview:
              outlineAfter.blocks.find((block) => block.blockId === created.blockId)?.text || ''
          }))

          const details = await runtime.fileReviewService.finalizeRunReview({
            runId: runtime.runId,
            workspaceRootPath: runtime.workspaceRoot
          })
          const reviewPath = details[0]?.review.draft_artifact_path
          if (!reviewPath) {
            throw new Error('expected review artifact path')
          }

          const reviewBundle = await loadDocxBundle(await fs.readFile(reviewPath))
          const reviewOutline = buildBlockIndex(reviewBundle.documentDom).outline
            .filter((block) => block.type !== 'table_cell')
            .map((block) => ({
              type: block.type,
              text: block.type === 'table' ? block.preview : block.text
            }))

          return {
            anchorBefore: anchorBefore.blocks[0],
            anchorAfter: anchorAfter.blocks[0],
            insertedParagraph,
            insertedTable,
            outlineAfter,
            createdPreviews,
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

        const createdBlockIds = [
          ...result.createdPreviews
        ]
        runtime.assertThat(
          !createdBlockIds.some((block) => block.preview.includes('学生端脚手架引导：')),
          {
            name: 'created-blocks-do-not-capture-shifted-tail-block',
            message: 'createdBlocks 只能命中新插入块，不得把下游旧段落误认为新增块。',
            data: {
              createdBlocks: {
                paragraph: result.insertedParagraph.createdBlocks,
                table: result.insertedTable.createdBlocks
              },
              createdPreviews: result.createdPreviews,
              outlineAfter: result.outlineAfter.blocks
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
